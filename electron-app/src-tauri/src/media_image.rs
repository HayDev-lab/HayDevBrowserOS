use image::metadata::Orientation;

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const EXIF_PREFIX: &[u8; 6] = b"Exif\0\0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImageFormat {
    Jpeg,
    Png,
    Webp,
}

impl ImageFormat {
    pub(crate) fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::Jpeg => &["jpg", "jpeg"],
            Self::Png => &["png"],
            Self::Webp => &["webp"],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImageError {
    Unsupported,
    Invalid,
}

pub(crate) fn clean(bytes: &[u8]) -> Result<(ImageFormat, Vec<u8>), ImageError> {
    if bytes.starts_with(b"\xff\xd8") {
        Ok((ImageFormat::Jpeg, clean_jpeg(bytes)?))
    } else if bytes.starts_with(PNG_SIGNATURE) {
        Ok((ImageFormat::Png, clean_png(bytes)?))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok((ImageFormat::Webp, clean_webp(bytes)?))
    } else {
        Err(ImageError::Unsupported)
    }
}

// Keep a single presentation field from EXIF. Offsets, thumbnails, GPS and
// maker notes from the original block are never copied.
fn orientation_only(bytes: &[u8]) -> Option<[u8; 26]> {
    let tiff = bytes.strip_prefix(EXIF_PREFIX).unwrap_or(bytes);
    let orientation = Orientation::from_exif_chunk(tiff)?.to_exif();
    if orientation == 1 {
        return None;
    }

    let mut result = *b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\0\0\0\0\0\0\0\0";
    result[18] = orientation;
    Some(result)
}

fn jpeg_segment(output: &mut Vec<u8>, marker: u8, payload: &[u8]) {
    output.extend_from_slice(&[0xff, marker]);
    output.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    output.extend_from_slice(payload);
}

fn clean_jpeg(bytes: &[u8]) -> Result<Vec<u8>, ImageError> {
    let mut output = Vec::with_capacity(bytes.len());
    output.extend_from_slice(b"\xff\xd8");
    let mut offset = 2;
    let mut saw_scan = false;
    let mut kept_orientation = false;

    while offset < bytes.len() {
        let start = offset;
        if bytes[offset] != 0xff {
            return Err(ImageError::Invalid);
        }
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset).ok_or(ImageError::Invalid)?;
        offset += 1;

        match marker {
            0xd9 if saw_scan => {
                output.extend_from_slice(b"\xff\xd9");
                return Ok(output);
            }
            0x01 => {
                output.extend_from_slice(&bytes[start..offset]);
                continue;
            }
            0x00 | 0xd0..=0xd9 => return Err(ImageError::Invalid),
            _ => {}
        }

        let size = bytes.get(offset..offset + 2).ok_or(ImageError::Invalid)?;
        let size = u16::from_be_bytes([size[0], size[1]]) as usize;
        let end = offset + size;
        let payload = bytes.get(offset + 2..end).ok_or(ImageError::Invalid)?;

        match marker {
            // MPF can carry another image or an HDR gain map after EOI.
            0xe2 if payload.starts_with(b"MPF\0") => return Err(ImageError::Unsupported),
            0xe0 if payload.starts_with(b"JFIF\0") && payload.len() >= 14 => {
                jpeg_segment(&mut output, marker, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
            }
            0xe1 if !kept_orientation && payload.starts_with(EXIF_PREFIX) => {
                if let Some(orientation) = orientation_only(payload) {
                    let mut exif = EXIF_PREFIX.to_vec();
                    exif.extend_from_slice(&orientation);
                    jpeg_segment(&mut output, marker, &exif);
                    kept_orientation = true;
                }
            }
            0xe2 if payload.starts_with(b"ICC_PROFILE\0") && payload.len() > 14 => {
                output.extend_from_slice(&bytes[start..end]);
            }
            0xee if payload.len() == 12 && payload.starts_with(b"Adobe") => {
                output.extend_from_slice(&bytes[start..end]);
            }
            // Other application markers and comments carry metadata.
            0xe0..=0xef | 0xfe => {}
            _ => output.extend_from_slice(&bytes[start..end]),
        }

        offset = end;
        if marker == 0xda {
            saw_scan = true;
            offset = jpeg_scan_end(bytes, end)?;
            output.extend_from_slice(&bytes[end..offset]);
        }
    }

    Err(ImageError::Invalid)
}

// JPEG entropy data can contain stuffed FF bytes and restart markers. Other
// markers end this scan. Progressive files may contain several scans.
fn jpeg_scan_end(bytes: &[u8], mut offset: usize) -> Result<usize, ImageError> {
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            offset += 1;
            continue;
        }
        let start = offset;
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        match bytes.get(offset) {
            Some(0x00 | 0xd0..=0xd7) => offset += 1,
            Some(_) => return Ok(start),
            None => break,
        }
    }
    Err(ImageError::Invalid)
}

fn png_chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let crc_start = output.len();
    output.extend_from_slice(kind);
    output.extend_from_slice(data);
    output.extend_from_slice(&crc32fast::hash(&output[crc_start..]).to_be_bytes());
}

fn clean_png(bytes: &[u8]) -> Result<Vec<u8>, ImageError> {
    let mut output = Vec::with_capacity(bytes.len());
    output.extend_from_slice(PNG_SIGNATURE);
    let mut offset = PNG_SIGNATURE.len();
    let mut saw_image_data = false;
    let mut kept_orientation = false;

    while offset < bytes.len() {
        let header = bytes.get(offset..offset + 8).ok_or(ImageError::Invalid)?;
        let size = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        let kind: &[u8; 4] = header[4..].try_into().unwrap();
        let data_end = (offset + 8).checked_add(size).ok_or(ImageError::Invalid)?;
        let end = data_end.checked_add(4).ok_or(ImageError::Invalid)?;
        let chunk = bytes.get(offset..end).ok_or(ImageError::Invalid)?;
        let data = &chunk[8..8 + size];
        if !kind.iter().all(u8::is_ascii_alphabetic)
            || crc32fast::hash(&chunk[4..8 + size]).to_be_bytes() != chunk[8 + size..]
        {
            return Err(ImageError::Invalid);
        }
        if (offset == PNG_SIGNATURE.len()) != (kind == b"IHDR") {
            return Err(ImageError::Invalid);
        }

        match kind {
            b"IHDR" if size != 13 => return Err(ImageError::Invalid),
            b"IEND" if size == 0 && saw_image_data => {
                output.extend_from_slice(chunk);
                return Ok(output);
            }
            b"IEND" => return Err(ImageError::Invalid),
            b"IDAT" => {
                saw_image_data = true;
                output.extend_from_slice(chunk);
            }
            b"eXIf" if !kept_orientation => {
                if let Some(orientation) = orientation_only(data) {
                    png_chunk(&mut output, kind, &orientation);
                    kept_orientation = true;
                }
            }
            // Keep image data, color, transparency and APNG frame controls.
            b"IHDR" | b"PLTE" | b"tRNS" | b"cHRM" | b"gAMA" | b"iCCP" | b"sBIT" | b"sRGB"
            | b"bKGD" | b"cICP" | b"mDCv" | b"cLLi" | b"acTL" | b"fcTL" | b"fdAT" => {
                output.extend_from_slice(chunk);
            }
            _ if kind[0].is_ascii_uppercase() => return Err(ImageError::Unsupported),
            _ => {}
        }
        offset = end;
    }

    Err(ImageError::Invalid)
}

fn riff_chunk<'a>(
    bytes: &'a [u8],
    offset: &mut usize,
) -> Result<(&'a [u8; 4], &'a [u8]), ImageError> {
    let header = bytes.get(*offset..*offset + 8).ok_or(ImageError::Invalid)?;
    let kind = header[..4].try_into().unwrap();
    let size = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
    let start = *offset + 8;
    let end = start.checked_add(size).ok_or(ImageError::Invalid)?;
    let next = end.checked_add(size % 2).ok_or(ImageError::Invalid)?;
    if next > bytes.len() {
        return Err(ImageError::Invalid);
    }
    *offset = next;
    Ok((kind, &bytes[start..end]))
}

fn write_riff_chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    output.extend_from_slice(kind);
    output.extend_from_slice(&(data.len() as u32).to_le_bytes());
    output.extend_from_slice(data);
    if data.len() % 2 == 1 {
        output.push(0);
    }
}

fn clean_webp(bytes: &[u8]) -> Result<Vec<u8>, ImageError> {
    let size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let end = size.checked_add(8).ok_or(ImageError::Invalid)?;
    let bytes = bytes
        .get(..end)
        .filter(|b| b.len() >= 12)
        .ok_or(ImageError::Invalid)?;
    let mut output = Vec::with_capacity(bytes.len());
    output.extend_from_slice(b"RIFF\0\0\0\0WEBP");
    let mut offset = 12;
    let mut flags_offset = None;
    let mut saw_image = false;
    let mut kept_orientation = false;

    while offset < bytes.len() {
        let (kind, data) = riff_chunk(bytes, &mut offset)?;
        match kind {
            b"VP8X" if data.len() == 10 && flags_offset.is_none() && output.len() == 12 => {
                let mut header: [u8; 10] = data.try_into().unwrap();
                header[0] &= 0x32; // ICC, alpha and animation.
                header[1..4].fill(0);
                flags_offset = Some(output.len() + 8);
                write_riff_chunk(&mut output, kind, &header);
            }
            b"VP8X" => return Err(ImageError::Invalid),
            b"VP8 " | b"VP8L" => {
                saw_image = true;
                write_riff_chunk(&mut output, kind, data);
            }
            b"ALPH" | b"ICCP" | b"ANIM" => write_riff_chunk(&mut output, kind, data),
            b"ANMF" => {
                let frame = clean_webp_frame(data)?;
                saw_image = true;
                write_riff_chunk(&mut output, kind, &frame);
            }
            b"EXIF" if !kept_orientation && flags_offset.is_some() => {
                if let Some(orientation) = orientation_only(data) {
                    let mut exif = Vec::new();
                    if data.starts_with(EXIF_PREFIX) {
                        exif.extend_from_slice(EXIF_PREFIX);
                    }
                    exif.extend_from_slice(&orientation);
                    write_riff_chunk(&mut output, kind, &exif);
                    kept_orientation = true;
                }
            }
            _ => {}
        }
    }

    if !saw_image {
        return Err(ImageError::Invalid);
    }
    if let Some(index) = flags_offset {
        if kept_orientation {
            output[index] |= 0x08;
        }
    }
    let size = (output.len() - 8) as u32;
    output[4..8].copy_from_slice(&size.to_le_bytes());
    Ok(output)
}

fn clean_webp_frame(data: &[u8]) -> Result<Vec<u8>, ImageError> {
    let mut frame = data.get(..16).ok_or(ImageError::Invalid)?.to_vec();
    let mut offset = 16;
    let mut saw_image = false;
    while offset < data.len() {
        let (kind, payload) = riff_chunk(data, &mut offset)?;
        match kind {
            b"VP8 " | b"VP8L" => {
                saw_image = true;
                write_riff_chunk(&mut frame, kind, payload);
            }
            b"ALPH" => write_riff_chunk(&mut frame, kind, payload),
            _ => {}
        }
    }
    saw_image.then_some(frame).ok_or(ImageError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn picture(format: image::ImageFormat) -> Vec<u8> {
        let rgb = image::RgbImage::from_pixel(4, 4, image::Rgb([25, 150, 220]));
        let mut buffer = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(rgb)
            .write_to(&mut buffer, format)
            .unwrap();
        buffer.into_inner()
    }

    fn assert_pixels_and_repeat(original: &[u8], cleaned: &[u8]) {
        assert_eq!(
            image::load_from_memory(original).unwrap().to_rgba8(),
            image::load_from_memory(cleaned).unwrap().to_rgba8(),
        );
        assert_eq!(clean(cleaned).unwrap().1, cleaned);
    }

    #[test]
    fn jpeg_removes_exif_gps_xmp_and_app11_but_keeps_orientation() {
        let source = picture(image::ImageFormat::Jpeg);
        let mut tagged = source[..2].to_vec();
        let mut exif = EXIF_PREFIX.to_vec();
        exif.extend_from_slice(
            b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0",
        );
        exif.extend_from_slice(b"GPS synthetic");
        jpeg_segment(&mut tagged, 0xe1, &exif);
        jpeg_segment(
            &mut tagged,
            0xe1,
            b"http://ns.adobe.com/xap/1.0/\0AI synthetic",
        );
        jpeg_segment(&mut tagged, 0xeb, b"JP synthetic C2PA");
        tagged.extend_from_slice(&source[2..]);

        let (_, output) = clean(&tagged).unwrap();
        assert!(output.starts_with(b"\xff\xd8\xff\xe1\0\x22Exif\0\0"));
        assert_eq!(
            Orientation::from_exif_chunk(&output[12..38])
                .unwrap()
                .to_exif(),
            6
        );
        assert!(!output
            .windows(b"synthetic".len())
            .any(|w| w == b"synthetic"));
        assert_pixels_and_repeat(&tagged, &output);
    }

    #[test]
    fn png_removes_text_provenance_and_trailing_data() {
        let source = picture(image::ImageFormat::Png);
        let mut tagged = source[..33].to_vec(); // Signature and IHDR.
        png_chunk(&mut tagged, b"tEXt", b"Software\0Synthetic AI generator");
        png_chunk(&mut tagged, b"caBX", b"Synthetic C2PA manifest");
        tagged.extend_from_slice(&source[33..]);
        tagged.extend_from_slice(b"Synthetic trailer");
        let (_, output) = clean(&tagged).unwrap();
        assert_eq!(output, source);
        assert_pixels_and_repeat(&source, &output);
    }

    #[test]
    fn webp_repairs_riff_size_and_drops_metadata_flags() {
        let source = picture(image::ImageFormat::WebP);
        let mut tagged = b"RIFF\0\0\0\0WEBP".to_vec();
        write_riff_chunk(&mut tagged, b"VP8X", &[0x0c, 0, 0, 0, 3, 0, 0, 3, 0, 0]);
        tagged.extend_from_slice(&source[12..]);
        write_riff_chunk(&mut tagged, b"EXIF", b"private");
        write_riff_chunk(&mut tagged, b"XMP ", b"AI generator");
        write_riff_chunk(&mut tagged, b"C2PA", b"Synthetic manifest");
        let size = (tagged.len() - 8) as u32;
        tagged[4..8].copy_from_slice(&size.to_le_bytes());
        let (_, output) = clean(&tagged).unwrap();
        assert_eq!(output[20], 0);
        assert!(!output
            .windows(4)
            .any(|w| matches!(w, b"EXIF" | b"XMP " | b"C2PA")));
        assert_pixels_and_repeat(&source, &output);
    }

    #[test]
    fn rejects_truncated_and_unknown_images() {
        assert_eq!(clean(b"\xff\xd8\xff"), Err(ImageError::Invalid));
        assert_eq!(clean(PNG_SIGNATURE), Err(ImageError::Invalid));
        assert_eq!(clean(b"RIFF\xff\xff\xff\xffWEBP"), Err(ImageError::Invalid));
        assert_eq!(clean(b"not an image"), Err(ImageError::Unsupported));
    }
}
