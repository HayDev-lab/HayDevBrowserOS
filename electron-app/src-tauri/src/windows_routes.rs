use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteInterface {
    index: u32,
    name: String,
}

#[derive(Serialize)]
pub struct WindowsRoutes {
    ipv4: Option<RouteInterface>,
    ipv6: Option<RouteInterface>,
}

#[cfg(windows)]
fn selected_route(address: std::net::IpAddr) -> Option<RouteInterface> {
    use std::net::IpAddr;
    use windows::Win32::NetworkManagement::IpHelper::{GetBestInterfaceEx, GetIfEntry2, MIB_IF_ROW2};
    use windows::Win32::Networking::WinSock::{
        AF_INET, AF_INET6, IN6_ADDR, IN6_ADDR_0, IN_ADDR, IN_ADDR_0, SOCKADDR_IN, SOCKADDR_IN6,
        SOCKADDR_INET,
    };

    let destination = match address {
        IpAddr::V4(ip) => SOCKADDR_INET {
            Ipv4: SOCKADDR_IN {
                sin_family: AF_INET,
                sin_addr: IN_ADDR { S_un: IN_ADDR_0 { S_addr: u32::from_ne_bytes(ip.octets()) } },
                ..Default::default()
            },
        },
        IpAddr::V6(ip) => SOCKADDR_INET {
            Ipv6: SOCKADDR_IN6 {
                sin6_family: AF_INET6,
                sin6_addr: IN6_ADDR { u: IN6_ADDR_0 { Byte: ip.octets() } },
                ..Default::default()
            },
        },
    };
    let mut index = 0;
    // SOCKADDR_INET is aligned for either address family. IP Helper only
    // reads the address and writes the selected interface index.
    if unsafe { GetBestInterfaceEx((&raw const destination).cast(), &mut index) } != 0 {
        return None;
    }
    let mut row = MIB_IF_ROW2 { InterfaceIndex: index, ..Default::default() };
    unsafe { GetIfEntry2(&mut row) }.ok().ok()?;
    let end = row.Description.iter().position(|unit| *unit == 0).unwrap_or(row.Description.len());
    Some(RouteInterface { index, name: String::from_utf16_lossy(&row.Description[..end]) })
}

/// Match the accepted side of the already connected local socket. A listener
/// lookup before connect alone could race with another process taking its port.
#[cfg(windows)]
pub(crate) fn tcp_peer_is_owned(stream: &std::net::TcpStream, pid: u32) -> bool {
    use std::net::SocketAddr;
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP_STATE_ESTAB, TCP_TABLE_OWNER_PID_CONNECTIONS,
    };
    use windows::Win32::Networking::WinSock::AF_INET;

    let (Ok(SocketAddr::V4(local)), Ok(SocketAddr::V4(peer))) =
        (stream.local_addr(), stream.peer_addr()) else { return false };
    let mut size = 0;
    let query = |buffer, size: &mut u32| unsafe {
        GetExtendedTcpTable(buffer, size, false, AF_INET.0.into(), TCP_TABLE_OWNER_PID_CONNECTIONS, 0)
    };
    if query(None, &mut size) != ERROR_INSUFFICIENT_BUFFER.0 || size > 32 * 1024 * 1024 {
        return false;
    }
    // MIB_TCPTABLE_OWNER_PID consists of a u32 count followed by rows of
    // six u32 fields. The u32 allocation supplies the required alignment.
    let mut words = vec![0u32; (size as usize).div_ceil(4)];
    if query(Some(words.as_mut_ptr().cast()), &mut size) != 0 {
        return false;
    }
    let Some((&count, rows)) = words.split_first() else { return false };
    rows.chunks_exact(6).take(count as usize).any(|row| {
        row[0] == MIB_TCP_STATE_ESTAB.0 as u32
            && row[1] == u32::from_ne_bytes(peer.ip().octets())
            && u16::from_be(row[2] as u16) == peer.port()
            && row[3] == u32::from_ne_bytes(local.ip().octets())
            && u16::from_be(row[4] as u16) == local.port()
            && row[5] == pid
    })
}

#[cfg(not(windows))]
pub(crate) fn tcp_peer_is_owned(_: &std::net::TcpStream, _: u32) -> bool {
    false
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn matches_the_connected_socket_and_owning_pid() {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let stream = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_accepted, _) = listener.accept().unwrap();
        let pid = std::process::id();
        assert!(super::tcp_peer_is_owned(&stream, pid));
        assert!(!super::tcp_peer_is_owned(&stream, 0));
    }
}

/// A local routing-table lookup. It makes no connections and does not
/// establish that WFP permits the route or that a tunnel is protecting it.
#[tauri::command]
pub fn windows_route_status(webview: tauri::Webview<tauri::Wry>) -> crate::error::AppResult<WindowsRoutes> {
    crate::arman_vpn::trusted(&webview)?;
    #[cfg(windows)]
    return Ok(WindowsRoutes {
        ipv4: selected_route(std::net::Ipv4Addr::new(1, 1, 1, 1).into()),
        ipv6: selected_route(std::net::Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111).into()),
    });
    #[cfg(not(windows))]
    Err(crate::error::AppError::new("WINDOWS_ROUTE_UNAVAILABLE", "Windows routing table unavailable"))
}
