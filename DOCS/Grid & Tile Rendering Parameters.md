# Grid & Tile Rendering Parameters

This document outlines the variables and logic controlling the geometry for each level type and render style in `components/GameCanvas.tsx`.

## Global Parameters
| Variable | Value | Description |
| :--- | :--- | :--- |
| `LANE_WIDTH` | `3.0` | Width of a standard lane. |
| `SEGMENT_LENGTH` | `12.0` | Length of one generated chunk (Multiple of LANE_WIDTH). |

## Level Specifics

### Flat Level
| Render Style | Logic | Description |
| :--- | :--- | :--- |
| **GRID** | `LANE_COUNT_FLAT` = `7` | Total number of lanes. |
| **GRID** | Grid Lines (Z) | Drawn every `LANE_WIDTH` (3.0). |
| **TILES** | Geometry | `PlaneGeometry(LANE_WIDTH, SEGMENT_LENGTH)` (3x12 strip per lane). |

### Tube (Round) Level
| Render Style | Logic | Description |
| :--- | :--- | :--- |
| **GRID** | `LANE_COUNT_ROUND` = `12` | Number of sides in the cylinder. |
| **GRID** | `RADIUS_ROUND` = `8.0` | Radius of the tunnel. |
| **GRID** | Grid Lines (Z) | **Manual Loop**: Drawn every `LANE_WIDTH` (3.0) to form square cells. |
| **TILES** | Geometry | `PlaneGeometry(chordWidth, SEGMENT_LENGTH)` (approx 4x12 strip per lane). |
| **Note** | Aspect Ratio | In TILES mode, tiles appear as long 1x3 or 1x4 rectangles because they are single continuous planes per segment. |

### Square Level
| Render Style | Logic | Description |
| :--- | :--- | :--- |
| **GRID** | `SQUARE_SIDE_WIDTH` = `9.0` | Width of one side (3 * LANE_WIDTH). |
| **GRID** | Grid Lines (Z) | Drawn every `LANE_WIDTH` (3.0). |
| **TILES** | Geometry | `PlaneGeometry(LANE_WIDTH, SEGMENT_LENGTH)` (3x12 strip per sub-lane). |
