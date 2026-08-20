"""Self-check for the recording window/downsample logic.

Run it directly:  python test_recordings.py

`_slice_and_downsample` is the only non-trivial arithmetic in the recordings
endpoints — everything else is file I/O. Its edge cases (reversed bounds,
out-of-range bounds) are reachable from the UI by dragging a range slider, so
they are checked here rather than discovered live.
"""

from app import MAX_CHART_POINTS, _slice_and_downsample


def _rows(n):
    """Stand-in for csv.DictReader output — only identity matters here."""
    return [{"Sample": i} for i in range(n)]


def demo():
    # No bounds → unchanged for a short recording.
    rows = _rows(500)
    window, start, end = _slice_and_downsample(rows)
    assert window == rows, "short recording must pass through untouched"
    assert (start, end) == (0, 500), (start, end)

    # No bounds → thinned to the cap for a long one, keeping order and the first row.
    window, start, end = _slice_and_downsample(_rows(60_000))
    assert len(window) == MAX_CHART_POINTS, len(window)
    assert window[0]["Sample"] == 0
    assert [r["Sample"] for r in window] == sorted(r["Sample"] for r in window)
    assert (start, end) == (0, 60_000), (start, end)

    # A sub-window returns only rows inside it, and un-thinned when it fits.
    window, start, end = _slice_and_downsample(_rows(60_000), 1000, 1600)
    assert len(window) == 600, len(window)
    assert window[0]["Sample"] == 1000 and window[-1]["Sample"] == 1599
    assert (start, end) == (1000, 1600), (start, end)

    # This is the point of the whole feature: zooming in raises resolution.
    # 600 rows of a 60 000-row file arrive whole, where the full view sends 1 in 60.
    full, _, _ = _slice_and_downsample(_rows(60_000))
    assert len(window) / 600 > len(full) / 60_000, "zoom must beat the full view"

    # A window wider than the cap is still thinned.
    window, _, _ = _slice_and_downsample(_rows(60_000), 0, 50_000)
    assert len(window) == MAX_CHART_POINTS, len(window)

    # Reversed bounds are swapped, not rejected — a slider drags through these.
    window, start, end = _slice_and_downsample(_rows(1000), 800, 200)
    assert (start, end) == (200, 800), (start, end)
    assert len(window) == 600, len(window)

    # Out-of-range bounds clamp instead of raising or returning junk.
    window, start, end = _slice_and_downsample(_rows(1000), -50, 99_999)
    assert (start, end) == (0, 1000), (start, end)
    assert len(window) == 1000, len(window)

    # Degenerate cases: empty window, empty file.
    window, start, end = _slice_and_downsample(_rows(1000), 500, 500)
    assert window == [] and (start, end) == (500, 500)
    window, start, end = _slice_and_downsample([], 10, 20)
    assert window == [] and (start, end) == (0, 0), (start, end)

    print("all recording window checks passed")


if __name__ == "__main__":
    demo()
