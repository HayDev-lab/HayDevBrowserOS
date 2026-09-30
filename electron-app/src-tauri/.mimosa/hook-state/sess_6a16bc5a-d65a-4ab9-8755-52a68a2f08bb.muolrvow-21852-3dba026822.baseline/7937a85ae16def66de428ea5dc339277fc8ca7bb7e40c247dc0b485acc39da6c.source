//! Chrome layout — must stay in sync with `CHROME_LAYOUT` in
//! `src/shared/browser-types.ts` and the CSS tokens in design-tokens.css.

/// Custom title bar (brand + nav + status + window controls).
pub const TITLEBAR_HEIGHT: f64 = 40.0;
/// Title bar (40) + tab strip (44) + toolbar (44) reserved at the top.
pub const TOP_HEIGHT: f64 = 128.0;
/// Status footer reserved at the bottom of the window.
pub const FOOTER_HEIGHT: f64 = 24.0;
/// Width of the docked agent rail (right column).
pub const AGENT_PANEL_WIDTH: f64 = 360.0;
/// Below this content width the agent rail is hidden (narrow layout).
pub const AGENT_PANEL_MIN_WIDTH: f64 = 980.0;
/// Windows maximized windows inflate by the resize border; the gutters
/// guarantee the tab webview never paints over the rail edge or under the
/// footer (same constant as the Electron BrowserCore).
const RAIL_GUTTER: f64 = 16.0;

/// The rectangle the ACTIVE tab webview occupies, in logical pixels,
/// given the window's inner size. Mirrors `BrowserCore.layoutViews`.
pub fn content_rect(win_width: f64, win_height: f64) -> (f64, f64, f64, f64) {
    let agent_rail = if win_width >= AGENT_PANEL_MIN_WIDTH {
        AGENT_PANEL_WIDTH
    } else {
        0.0
    };
    let width = (win_width - agent_rail - RAIL_GUTTER).max(0.0);
    let height = (win_height - TOP_HEIGHT - FOOTER_HEIGHT - RAIL_GUTTER).max(0.0);
    (0.0, TOP_HEIGHT, width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_window_reserves_agent_rail() {
        let (x, y, w, h) = content_rect(1440.0, 900.0);
        assert_eq!((x, y), (0.0, 128.0));
        assert!((w - (1440.0 - 360.0 - 16.0)).abs() < f64::EPSILON);
        assert!((h - (900.0 - 128.0 - 24.0 - 16.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn narrow_window_drops_rail() {
        let (_, _, w, _) = content_rect(800.0, 700.0);
        assert!((w - (800.0 - 16.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn never_negative() {
        let (_, _, w, h) = content_rect(100.0, 100.0);
        // Width: 100 (no rail below 980) − 16 gutter = 84; height clamps to 0.
        assert_eq!((w, h), (84.0, 0.0));
    }
}
