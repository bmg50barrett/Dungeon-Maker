/*
 * The Dungeon Tiles catalog (catalog/tiles.json from github.com/bmg50barrett/Dungeon-Tiles), kept in the app so the tile list
 * works offline and the page never fetches anything. Do not edit by hand: refresh it with  node tools/update-tile-catalog.js
 * after the tiles change.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});
  DM.TILE_CATALOG = {
    "catalog_version": 1,
    "grid": {
      "square_inches": 1,
      "square_feet": 5
    },
    "wall_thickness_inches": 0.15,
    "edge_convention": "Sides N, E, S, W in the canonical orientation. Openings are [offset, width] in squares, offsets measured clockwise: N from the west end, E from the north end, S from the east end, W from the south end. A face can be turned to any of 4 orientations; turning 90 degrees clockwise moves openings N->E->S->W->N.",
    "faces": {
      "R4-1": {
        "name": "Room 4x4 (20 ft), 1 door",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 10,
        "openings": {
          "N": [
            [
              1,
              2
            ]
          ],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R4-2O": {
        "name": "Room 4x4 (20 ft), 2 doors, opposite",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 10,
        "openings": {
          "N": [
            [
              1,
              2
            ]
          ],
          "E": [],
          "S": [
            [
              1,
              2
            ]
          ],
          "W": []
        }
      },
      "R4-2C": {
        "name": "Room 4x4 (20 ft), 2 doors, corner",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 10,
        "openings": {
          "N": [
            [
              1,
              2
            ]
          ],
          "E": [
            [
              1,
              2
            ]
          ],
          "S": [],
          "W": []
        }
      },
      "R4-3": {
        "name": "Room 4x4 (20 ft), 3 doors",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 10,
        "openings": {
          "N": [
            [
              1,
              2
            ]
          ],
          "E": [
            [
              1,
              2
            ]
          ],
          "S": [
            [
              1,
              2
            ]
          ],
          "W": []
        }
      },
      "R4-4": {
        "name": "Room 4x4 (20 ft), 4 doors",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 10,
        "openings": {
          "N": [
            [
              1,
              2
            ]
          ],
          "E": [
            [
              1,
              2
            ]
          ],
          "S": [
            [
              1,
              2
            ]
          ],
          "W": [
            [
              1,
              2
            ]
          ]
        }
      },
      "R5-1": {
        "name": "Room 5x5 (25 ft), 1 door",
        "kind": "room",
        "size": [
          5,
          5
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R5-2O": {
        "name": "Room 5x5 (25 ft), 2 doors, opposite",
        "kind": "room",
        "size": [
          5,
          5
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": []
        }
      },
      "R5-2C": {
        "name": "Room 5x5 (25 ft), 2 doors, corner",
        "kind": "room",
        "size": [
          5,
          5
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [],
          "W": []
        }
      },
      "R5-3": {
        "name": "Room 5x5 (25 ft), 3 doors",
        "kind": "room",
        "size": [
          5,
          5
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": []
        }
      },
      "R5-4": {
        "name": "Room 5x5 (25 ft), 4 doors",
        "kind": "room",
        "size": [
          5,
          5
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": [
            [
              2,
              1
            ]
          ]
        }
      },
      "R4P-1": {
        "name": "Room 4x4 (20 ft), 5 ft doors, 1 door",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              1,
              1
            ]
          ],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R4P-2O": {
        "name": "Room 4x4 (20 ft), 5 ft doors, 2 doors, opposite",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              1,
              1
            ]
          ],
          "E": [],
          "S": [
            [
              1,
              1
            ]
          ],
          "W": []
        }
      },
      "R4P-2C": {
        "name": "Room 4x4 (20 ft), 5 ft doors, 2 doors, corner",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              1,
              1
            ]
          ],
          "E": [
            [
              1,
              1
            ]
          ],
          "S": [],
          "W": []
        }
      },
      "R4P-3": {
        "name": "Room 4x4 (20 ft), 5 ft doors, 3 doors",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              1,
              1
            ]
          ],
          "E": [
            [
              1,
              1
            ]
          ],
          "S": [
            [
              1,
              1
            ]
          ],
          "W": []
        }
      },
      "R4P-4": {
        "name": "Room 4x4 (20 ft), 5 ft doors, 4 doors",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              1,
              1
            ]
          ],
          "E": [
            [
              1,
              1
            ]
          ],
          "S": [
            [
              1,
              1
            ]
          ],
          "W": [
            [
              1,
              1
            ]
          ]
        }
      },
      "H5-S4": {
        "name": "5 ft hall, straight, 4 long (20 ft)",
        "kind": "hall",
        "size": [
          1,
          4
        ],
        "hall_width_ft": 5,
        "openings": {
          "N": [
            [
              0,
              1
            ]
          ],
          "E": [],
          "S": [
            [
              0,
              1
            ]
          ],
          "W": []
        }
      },
      "H5-S5": {
        "name": "5 ft hall, straight, 5 long (25 ft)",
        "kind": "hall",
        "size": [
          1,
          5
        ],
        "hall_width_ft": 5,
        "openings": {
          "N": [
            [
              0,
              1
            ]
          ],
          "E": [],
          "S": [
            [
              0,
              1
            ]
          ],
          "W": []
        }
      },
      "H5-S1": {
        "name": "5 ft hall, straight, 1 long (5 ft)",
        "kind": "hall",
        "size": [
          1,
          1
        ],
        "hall_width_ft": 5,
        "openings": {
          "N": [
            [
              0,
              1
            ]
          ],
          "E": [],
          "S": [
            [
              0,
              1
            ]
          ],
          "W": []
        }
      },
      "H10-S5": {
        "name": "10 ft hall, straight, 5 long (25 ft)",
        "kind": "hall",
        "size": [
          2,
          5
        ],
        "hall_width_ft": 10,
        "openings": {
          "N": [
            [
              0,
              2
            ]
          ],
          "E": [],
          "S": [
            [
              0,
              2
            ]
          ],
          "W": []
        }
      },
      "H5-L": {
        "name": "5 ft hall, corner",
        "kind": "hall",
        "size": [
          1,
          1
        ],
        "hall_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              0,
              1
            ]
          ],
          "S": [
            [
              0,
              1
            ]
          ],
          "W": []
        }
      },
      "H5-T": {
        "name": "5 ft hall, T-junction",
        "kind": "hall",
        "size": [
          1,
          1
        ],
        "hall_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              0,
              1
            ]
          ],
          "S": [
            [
              0,
              1
            ]
          ],
          "W": [
            [
              0,
              1
            ]
          ]
        }
      },
      "H5-X": {
        "name": "5 ft hall, crossroads",
        "kind": "hall",
        "size": [
          1,
          1
        ],
        "hall_width_ft": 5,
        "openings": {
          "N": [
            [
              0,
              1
            ]
          ],
          "E": [
            [
              0,
              1
            ]
          ],
          "S": [
            [
              0,
              1
            ]
          ],
          "W": [
            [
              0,
              1
            ]
          ]
        }
      },
      "H5-D": {
        "name": "5 ft hall, dead end",
        "kind": "hall",
        "size": [
          1,
          1
        ],
        "hall_width_ft": 5,
        "openings": {
          "N": [],
          "E": [],
          "S": [
            [
              0,
              1
            ]
          ],
          "W": []
        }
      },
      "R56-1A": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 1 door, end",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R56-1B": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 1 door, side",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [],
          "W": []
        }
      },
      "R56-2A": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 2 doors, both ends",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": []
        }
      },
      "R56-2B": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 2 doors, both sides",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [],
          "W": [
            [
              2,
              1
            ]
          ]
        }
      },
      "R56-2C": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 2 doors, corner, right",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [],
          "W": []
        }
      },
      "R56-2D": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 2 doors, corner, left",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [],
          "W": [
            [
              2,
              1
            ]
          ]
        }
      },
      "R56-3A": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 3 doors, both ends and a side",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": []
        }
      },
      "R56-3B": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 3 doors, both sides and an end",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": [
            [
              2,
              1
            ]
          ]
        }
      },
      "R56-4": {
        "name": "Room 5x6 (25x30 ft), 5 ft doors, 4 doors",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              2,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": [
            [
              2,
              1
            ]
          ]
        }
      },
      "R57-1A": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 1 door, end",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R57-1B": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 1 door, side",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              3,
              1
            ]
          ],
          "S": [],
          "W": []
        }
      },
      "R57-2A": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 2 doors, both ends",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": []
        }
      },
      "R57-2B": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 2 doors, both sides",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              3,
              1
            ]
          ],
          "S": [],
          "W": [
            [
              3,
              1
            ]
          ]
        }
      },
      "R57-2C": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 2 doors, corner, right",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              3,
              1
            ]
          ],
          "S": [],
          "W": []
        }
      },
      "R57-2D": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 2 doors, corner, left",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [],
          "S": [],
          "W": [
            [
              3,
              1
            ]
          ]
        }
      },
      "R57-3A": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 3 doors, both ends and a side",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              3,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": []
        }
      },
      "R57-3B": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 3 doors, both sides and an end",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [],
          "E": [
            [
              3,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": [
            [
              3,
              1
            ]
          ]
        }
      },
      "R57-4": {
        "name": "Room 5x7 (25x35 ft), 5 ft doors, 4 doors",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": 5,
        "openings": {
          "N": [
            [
              2,
              1
            ]
          ],
          "E": [
            [
              3,
              1
            ]
          ],
          "S": [
            [
              2,
              1
            ]
          ],
          "W": [
            [
              3,
              1
            ]
          ]
        }
      },
      "R44-0": {
        "name": "Room 4x4 (20x20 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          4,
          4
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R45-0": {
        "name": "Room 4x5 (20x25 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          4,
          5
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R46-0": {
        "name": "Room 4x6 (20x30 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          4,
          6
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R47-0": {
        "name": "Room 4x7 (20x35 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          4,
          7
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R48-0": {
        "name": "Room 4x8 (20x40 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          4,
          8
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R55-0": {
        "name": "Room 5x5 (25x25 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          5,
          5
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R56-0": {
        "name": "Room 5x6 (25x30 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          5,
          6
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R57-0": {
        "name": "Room 5x7 (25x35 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          5,
          7
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R58-0": {
        "name": "Room 5x8 (25x40 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          5,
          8
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      },
      "R66-0": {
        "name": "Room 6x6 (30x30 ft), no doors (use door markers)",
        "kind": "room",
        "size": [
          6,
          6
        ],
        "door_width_ft": null,
        "openings": {
          "N": [],
          "E": [],
          "S": [],
          "W": []
        }
      }
    },
    "editions": [
      {
        "id": "full-rooms",
        "name": "Full Rooms",
        "file": "pdf/Dungeon Tiles - Full Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - Full Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 4,
        "pieces": [
          {
            "faces": [
              "R5-1"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R5-2O"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H10-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H10-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R5-2C"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R5-3"
            ],
            "sheet": 2,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H10-S5"
            ],
            "sheet": 2,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H10-S5"
            ],
            "sheet": 2,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R5-4"
            ],
            "sheet": 3,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4-1"
            ],
            "sheet": 3,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 3,
            "at": [
              4,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 3,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 3,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-X"
            ],
            "sheet": 3,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-D"
            ],
            "sheet": 3,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-D"
            ],
            "sheet": 3,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "H10-S5"
            ],
            "sheet": 3,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H10-S5"
            ],
            "sheet": 3,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R4-2O"
            ],
            "sheet": 4,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4-2C"
            ],
            "sheet": 4,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4-3"
            ],
            "sheet": 4,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4-4"
            ],
            "sheet": 4,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 4,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 4,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-X"
            ],
            "sheet": 4,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-D"
            ],
            "sheet": 4,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              4,
              9
            ]
          }
        ],
        "faces_available": {
          "H10-S5": 6,
          "H5-D": 3,
          "H5-L": 2,
          "H5-S4": 4,
          "H5-S5": 6,
          "H5-T": 2,
          "H5-X": 2,
          "R4-1": 1,
          "R4-2C": 1,
          "R4-2O": 1,
          "R4-3": 1,
          "R4-4": 1,
          "R5-1": 1,
          "R5-2C": 1,
          "R5-2O": 1,
          "R5-3": 1,
          "R5-4": 1
        }
      },
      {
        "id": "full-rooms-duplex",
        "name": "Full Rooms, Double-Sided",
        "file": "pdf/Dungeon Tiles - Full Rooms Double-Sided.pdf",
        "cut_guide": "pdf/Dungeon Tiles - Full Rooms Double-Sided Cut Guide.pdf",
        "double_sided": true,
        "sheets": 3,
        "pieces": [
          {
            "faces": [
              "R5-1",
              "R5-2O"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R5-2C",
              "R5-3"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H10-S5",
              "H10-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H10-S5",
              "H10-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R5-4",
              "R5-1"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4-1",
              "R4-2O"
            ],
            "sheet": 2,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 2,
            "at": [
              4,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 2,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 2,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 2,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 2,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 2,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "H10-S5",
              "H10-S5"
            ],
            "sheet": 2,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H10-S5",
              "H10-S5"
            ],
            "sheet": 2,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R4-2C",
              "R4-3"
            ],
            "sheet": 3,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4-4",
              "R4-1"
            ],
            "sheet": 3,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4-1",
              "R4-2C"
            ],
            "sheet": 3,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4-2O",
              "R4-3"
            ],
            "sheet": 3,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 3,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 3,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 3,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 3,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 3,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 3,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 3,
            "at": [
              4,
              9
            ]
          }
        ],
        "faces_available": {
          "H10-S5": 4,
          "H5-D": 4,
          "H5-L": 5,
          "H5-S4": 4,
          "H5-S5": 4,
          "H5-T": 5,
          "H5-X": 4,
          "R4-1": 3,
          "R4-2C": 2,
          "R4-2O": 2,
          "R4-3": 2,
          "R4-4": 1,
          "R5-1": 2,
          "R5-2C": 1,
          "R5-2O": 1,
          "R5-3": 1,
          "R5-4": 1
        }
      },
      {
        "id": "rooms-4x4",
        "name": "4x4 Rooms, 5 ft Doors",
        "file": "pdf/Dungeon Tiles - 4x4 Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x4 Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 2,
        "pieces": [
          {
            "faces": [
              "R4P-1"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4P-2O"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4P-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4P-3"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-X"
            ],
            "sheet": 1,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-D"
            ],
            "sheet": 1,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "R4P-1"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4P-2O"
            ],
            "sheet": 2,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4P-2C"
            ],
            "sheet": 2,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4P-4"
            ],
            "sheet": 2,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 2,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 2,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 2,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 2,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-X"
            ],
            "sheet": 2,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-D"
            ],
            "sheet": 2,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 2,
            "at": [
              4,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-D": 2,
          "H5-L": 2,
          "H5-S4": 6,
          "H5-T": 2,
          "H5-X": 2,
          "R4P-1": 2,
          "R4P-2C": 2,
          "R4P-2O": 2,
          "R4P-3": 1,
          "R4P-4": 1
        }
      },
      {
        "id": "rooms-4x4-duplex",
        "name": "4x4 Rooms, 5 ft Doors, Double-Sided",
        "file": "pdf/Dungeon Tiles - 4x4 Rooms Double-Sided.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x4 Rooms Double-Sided Cut Guide.pdf",
        "double_sided": true,
        "sheets": 2,
        "pieces": [
          {
            "faces": [
              "R4P-2O",
              "R4P-1"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4P-2O",
              "R4P-2C"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4P-2O",
              "R4P-3"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4P-1",
              "R4P-2C"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 1,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 1,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "R4P-2O",
              "R4P-1"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4P-2O",
              "R4P-2C"
            ],
            "sheet": 2,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4P-3",
              "R4P-2C"
            ],
            "sheet": 2,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4P-4",
              "R4P-3"
            ],
            "sheet": 2,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 2,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 2,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 2,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 2,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 2,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-X",
              "H5-D"
            ],
            "sheet": 2,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 2,
            "at": [
              4,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-D": 4,
          "H5-L": 4,
          "H5-S4": 6,
          "H5-T": 4,
          "H5-X": 4,
          "R4P-1": 3,
          "R4P-2C": 4,
          "R4P-2O": 5,
          "R4P-3": 3,
          "R4P-4": 1
        }
      },
      {
        "id": "halls-5ft",
        "name": "5 ft Hallways",
        "file": "pdf/Dungeon Tiles - 5 ft Hallways.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5 ft Hallways Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              1,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              2,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              3,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              1,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              2,
              4
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              3,
              4
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              5,
              4
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              6,
              4
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              4
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              3,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              4,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              3,
              6
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              4,
              6
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              5,
              6
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              6,
              6
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              6
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              3,
              7
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              4,
              7
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              5,
              7
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              6,
              7
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              7
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              1,
              8
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              2,
              8
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              3,
              8
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              5,
              8
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              6,
              8
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              7,
              8
            ]
          },
          {
            "faces": [
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              5,
              9
            ]
          },
          {
            "faces": [
              "H5-X"
            ],
            "sheet": 1,
            "at": [
              6,
              9
            ]
          },
          {
            "faces": [
              "H5-D"
            ],
            "sheet": 1,
            "at": [
              7,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-D": 1,
          "H5-L": 15,
          "H5-S1": 10,
          "H5-S4": 11,
          "H5-S5": 1,
          "H5-T": 4,
          "H5-X": 1
        }
      },
      {
        "id": "halls-5ft-duplex",
        "name": "5 ft Hallways, Double-Sided",
        "file": "pdf/Dungeon Tiles - 5 ft Hallways Double-Sided.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5 ft Hallways Double-Sided Cut Guide.pdf",
        "double_sided": true,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              1,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              2,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              3,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              1,
              4
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              2,
              4
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              3,
              4
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              5,
              4
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              6,
              4
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              4
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              3,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              4,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              3,
              6
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              4,
              6
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              5,
              6
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              6,
              6
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              6
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              3,
              7
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              4,
              7
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              5,
              7
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              6,
              7
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              7,
              7
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              1,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              2,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              3,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              5,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              6,
              8
            ]
          },
          {
            "faces": [
              "H5-S1",
              "H5-X"
            ],
            "sheet": 1,
            "at": [
              7,
              8
            ]
          },
          {
            "faces": [
              "H5-S1",
              "H5-X"
            ],
            "sheet": 1,
            "at": [
              5,
              9
            ]
          },
          {
            "faces": [
              "H5-S1",
              "H5-D"
            ],
            "sheet": 1,
            "at": [
              6,
              9
            ]
          },
          {
            "faces": [
              "H5-S1",
              "H5-D"
            ],
            "sheet": 1,
            "at": [
              7,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-D": 2,
          "H5-L": 27,
          "H5-S1": 20,
          "H5-S4": 11,
          "H5-S5": 1,
          "H5-T": 8,
          "H5-X": 2
        }
      },
      {
        "id": "pack-4x4",
        "name": "4x4 Room Pack",
        "file": "pdf/Dungeon Tiles - 4x4 Room Pack.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x4 Room Pack Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R4P-1"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4P-1"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4P-2O"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4P-2C"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              5,
              9
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              6,
              9
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-L": 5,
          "H5-S1": 3,
          "H5-S4": 2,
          "R4P-1": 2,
          "R4P-2C": 1,
          "R4P-2O": 1
        }
      },
      {
        "id": "pack-5x5-a",
        "name": "5x5 Room Pack A",
        "file": "pdf/Dungeon Tiles - 5x5 Room Pack A.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x5 Room Pack A Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R5-1"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R5-2O"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              5,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              6,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              1
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              2
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              3
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              4
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              6
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              7
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              8
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-L": 8,
          "H5-S1": 4,
          "H5-S4": 2,
          "H5-S5": 2,
          "R5-1": 1,
          "R5-2O": 1
        }
      },
      {
        "id": "pack-5x5-b",
        "name": "5x5 Room Pack B",
        "file": "pdf/Dungeon Tiles - 5x5 Room Pack B.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x5 Room Pack B Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R5-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R5-3"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              5,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              6,
              9
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              1
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              2
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              3
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              4
            ]
          },
          {
            "faces": [
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              6
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              7
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              8
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-L": 8,
          "H5-S1": 4,
          "H5-S4": 2,
          "H5-S5": 2,
          "R5-2C": 1,
          "R5-3": 1
        }
      },
      {
        "id": "pack-4x4-duplex",
        "name": "4x4 Room Pack, Double-Sided",
        "file": "pdf/Dungeon Tiles - 4x4 Room Pack Double-Sided.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x4 Room Pack Double-Sided Cut Guide.pdf",
        "double_sided": true,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R4P-1",
              "R4P-3"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R4P-1",
              "R4P-2C"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R4P-2O",
              "R4P-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R4P-2O",
              "R4P-4"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              1,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              2,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              3,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              5,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              6,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              7,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-L": 8,
          "H5-S1": 5,
          "H5-S4": 2,
          "H5-T": 3,
          "R4P-1": 2,
          "R4P-2C": 2,
          "R4P-2O": 2,
          "R4P-3": 1,
          "R4P-4": 1
        }
      },
      {
        "id": "pack-5x5-duplex",
        "name": "5x5 Room Pack, Double-Sided",
        "file": "pdf/Dungeon Tiles - 5x5 Room Pack Double-Sided.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x5 Room Pack Double-Sided Cut Guide.pdf",
        "double_sided": true,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R5-1",
              "R5-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R5-2O",
              "R5-3"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S4",
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              5,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-L"
            ],
            "sheet": 1,
            "at": [
              6,
              9
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              1
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              2
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              3
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              4
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              7,
              6
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              7,
              7
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              7,
              8
            ]
          },
          {
            "faces": [
              "H5-L",
              "H5-T"
            ],
            "sheet": 1,
            "at": [
              7,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-L": 12,
          "H5-S1": 6,
          "H5-S4": 2,
          "H5-S5": 2,
          "H5-T": 4,
          "R5-1": 1,
          "R5-2C": 1,
          "R5-2O": 1,
          "R5-3": 1
        }
      },
      {
        "id": "rooms-5x6",
        "name": "5x6 Rooms, 5 ft Doors",
        "file": "pdf/Dungeon Tiles - 5x6 Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 5,
        "pieces": [
          {
            "faces": [
              "R56-1A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-1B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R56-2A"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-2B"
            ],
            "sheet": 2,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R56-2C"
            ],
            "sheet": 3,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-2D"
            ],
            "sheet": 3,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R56-3A"
            ],
            "sheet": 4,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-3B"
            ],
            "sheet": 4,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 4,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 4,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 4,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 4,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R56-4"
            ],
            "sheet": 5,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-1B"
            ],
            "sheet": 5,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 5,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 5,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 5,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 5,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 20,
          "R56-1A": 1,
          "R56-1B": 2,
          "R56-2A": 1,
          "R56-2B": 1,
          "R56-2C": 1,
          "R56-2D": 1,
          "R56-3A": 1,
          "R56-3B": 1,
          "R56-4": 1
        }
      },
      {
        "id": "rooms-5x6-duplex",
        "name": "5x6 Rooms, 5 ft Doors, Double-Sided",
        "file": "pdf/Dungeon Tiles - 5x6 Rooms Double-Sided.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Rooms Double-Sided Cut Guide.pdf",
        "double_sided": true,
        "sheets": 3,
        "pieces": [
          {
            "faces": [
              "R56-1A",
              "R56-3A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-1B",
              "R56-3B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R56-1A",
              "R56-2C"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-1B",
              "R56-2D"
            ],
            "sheet": 2,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R56-2A",
              "R56-4"
            ],
            "sheet": 3,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-2B",
              "R56-1A"
            ],
            "sheet": 3,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 12,
          "R56-1A": 3,
          "R56-1B": 2,
          "R56-2A": 1,
          "R56-2B": 1,
          "R56-2C": 1,
          "R56-2D": 1,
          "R56-3A": 1,
          "R56-3B": 1,
          "R56-4": 1
        }
      },
      {
        "id": "pack-5x6-a",
        "name": "5x6 Room Pack A",
        "file": "pdf/Dungeon Tiles - 5x6 Room Pack A.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Room Pack A Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R56-1A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-1B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 4,
          "R56-1A": 1,
          "R56-1B": 1
        }
      },
      {
        "id": "pack-5x6-b",
        "name": "5x6 Room Pack B",
        "file": "pdf/Dungeon Tiles - 5x6 Room Pack B.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Room Pack B Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R56-2A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-2B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 4,
          "R56-2A": 1,
          "R56-2B": 1
        }
      },
      {
        "id": "pack-5x6-c",
        "name": "5x6 Room Pack C",
        "file": "pdf/Dungeon Tiles - 5x6 Room Pack C.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Room Pack C Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R56-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-2D"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 4,
          "R56-2C": 1,
          "R56-2D": 1
        }
      },
      {
        "id": "pack-5x6-duplex-a",
        "name": "5x6 Room Pack, Double-Sided A",
        "file": "pdf/Dungeon Tiles - 5x6 Room Pack Double-Sided A.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Room Pack Double-Sided A Cut Guide.pdf",
        "double_sided": true,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R56-1A",
              "R56-2A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-1B",
              "R56-2B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 4,
          "R56-1A": 1,
          "R56-1B": 1,
          "R56-2A": 1,
          "R56-2B": 1
        }
      },
      {
        "id": "pack-5x6-duplex-b",
        "name": "5x6 Room Pack, Double-Sided B",
        "file": "pdf/Dungeon Tiles - 5x6 Room Pack Double-Sided B.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Room Pack Double-Sided B Cut Guide.pdf",
        "double_sided": true,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R56-1A",
              "R56-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-1B",
              "R56-2D"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 4,
          "R56-1A": 1,
          "R56-1B": 1,
          "R56-2C": 1,
          "R56-2D": 1
        }
      },
      {
        "id": "rooms-5x7",
        "name": "5x7 Rooms, 5 ft Doors",
        "file": "pdf/Dungeon Tiles - 5x7 Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 5,
        "pieces": [
          {
            "faces": [
              "R57-1A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-1B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R57-2A"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-2B"
            ],
            "sheet": 2,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R57-2C"
            ],
            "sheet": 3,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-2D"
            ],
            "sheet": 3,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R57-3A"
            ],
            "sheet": 4,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-3B"
            ],
            "sheet": 4,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 4,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 4,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R57-4"
            ],
            "sheet": 5,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-1B"
            ],
            "sheet": 5,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 5,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 5,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 10,
          "R57-1A": 1,
          "R57-1B": 2,
          "R57-2A": 1,
          "R57-2B": 1,
          "R57-2C": 1,
          "R57-2D": 1,
          "R57-3A": 1,
          "R57-3B": 1,
          "R57-4": 1
        }
      },
      {
        "id": "rooms-5x7-duplex",
        "name": "5x7 Rooms, 5 ft Doors, Double-Sided",
        "file": "pdf/Dungeon Tiles - 5x7 Rooms Double-Sided.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Rooms Double-Sided Cut Guide.pdf",
        "double_sided": true,
        "sheets": 3,
        "pieces": [
          {
            "faces": [
              "R57-1A",
              "R57-3A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-1B",
              "R57-3B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R57-1A",
              "R57-2C"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-1B",
              "R57-2D"
            ],
            "sheet": 2,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 2,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R57-2A",
              "R57-4"
            ],
            "sheet": 3,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-2B",
              "R57-1A"
            ],
            "sheet": 3,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 3,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 6,
          "R57-1A": 3,
          "R57-1B": 2,
          "R57-2A": 1,
          "R57-2B": 1,
          "R57-2C": 1,
          "R57-2D": 1,
          "R57-3A": 1,
          "R57-3B": 1,
          "R57-4": 1
        }
      },
      {
        "id": "pack-5x7-a",
        "name": "5x7 Room Pack A",
        "file": "pdf/Dungeon Tiles - 5x7 Room Pack A.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Room Pack A Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R57-1A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-1B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 2,
          "R57-1A": 1,
          "R57-1B": 1
        }
      },
      {
        "id": "pack-5x7-b",
        "name": "5x7 Room Pack B",
        "file": "pdf/Dungeon Tiles - 5x7 Room Pack B.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Room Pack B Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R57-2A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-2B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 2,
          "R57-2A": 1,
          "R57-2B": 1
        }
      },
      {
        "id": "pack-5x7-c",
        "name": "5x7 Room Pack C",
        "file": "pdf/Dungeon Tiles - 5x7 Room Pack C.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Room Pack C Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R57-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-2D"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 2,
          "R57-2C": 1,
          "R57-2D": 1
        }
      },
      {
        "id": "pack-5x7-duplex-a",
        "name": "5x7 Room Pack, Double-Sided A",
        "file": "pdf/Dungeon Tiles - 5x7 Room Pack Double-Sided A.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Room Pack Double-Sided A Cut Guide.pdf",
        "double_sided": true,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R57-1A",
              "R57-2A"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-1B",
              "R57-2B"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 2,
          "R57-1A": 1,
          "R57-1B": 1,
          "R57-2A": 1,
          "R57-2B": 1
        }
      },
      {
        "id": "pack-5x7-duplex-b",
        "name": "5x7 Room Pack, Double-Sided B",
        "file": "pdf/Dungeon Tiles - 5x7 Room Pack Double-Sided B.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Room Pack Double-Sided B Cut Guide.pdf",
        "double_sided": true,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R57-1A",
              "R57-2C"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-1B",
              "R57-2D"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5",
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 2,
          "R57-1A": 1,
          "R57-1B": 1,
          "R57-2C": 1,
          "R57-2D": 1
        }
      },
      {
        "id": "doorless-4x4",
        "name": "4x4 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 4x4 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x4 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-S4": 4,
          "R44-0": 4
        }
      },
      {
        "id": "doorless-4x5",
        "name": "4x5 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 4x5 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x5 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 1,
            "at": [
              4,
              5
            ]
          }
        ],
        "faces_available": {
          "R45-0": 4
        }
      },
      {
        "id": "doorless-4x6",
        "name": "4x6 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 4x6 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x6 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R46-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R46-0"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R46-0"
            ],
            "sheet": 1,
            "at": [
              0,
              6
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              6,
              6
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              7,
              6
            ]
          }
        ],
        "faces_available": {
          "H5-S4": 2,
          "R46-0": 3
        }
      },
      {
        "id": "doorless-4x7",
        "name": "4x7 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 4x7 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x7 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R47-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R47-0"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              7
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              7
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-S4": 6,
          "R47-0": 2
        }
      },
      {
        "id": "doorless-4x8",
        "name": "4x8 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 4x8 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 4x8 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R48-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R48-0"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          }
        ],
        "faces_available": {
          "H5-S4": 4,
          "R48-0": 2
        }
      },
      {
        "id": "doorless-5x5",
        "name": "5x5 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 5x5 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x5 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R55-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R55-0"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 6,
          "R55-0": 2
        }
      },
      {
        "id": "doorless-5x6",
        "name": "5x6 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 5x6 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x6 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R56-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-0"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 4,
          "R56-0": 2
        }
      },
      {
        "id": "doorless-5x7",
        "name": "5x7 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 5x7 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x7 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R57-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-0"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S5": 2,
          "R57-0": 2
        }
      },
      {
        "id": "doorless-5x8",
        "name": "5x8 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 5x8 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 5x8 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R58-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R58-0"
            ],
            "sheet": 1,
            "at": [
              0,
              5
            ]
          }
        ],
        "faces_available": {
          "R58-0": 2
        }
      },
      {
        "id": "doorless-6x6",
        "name": "6x6 Doorless Rooms",
        "file": "pdf/Dungeon Tiles - 6x6 Doorless Rooms.pdf",
        "cut_guide": "pdf/Dungeon Tiles - 6x6 Doorless Rooms Cut Guide.pdf",
        "double_sided": false,
        "sheets": 1,
        "pieces": [
          {
            "faces": [
              "R66-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              0,
              6
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              4,
              6
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 1,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 1,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S1": 2,
          "H5-S5": 2,
          "R44-0": 2,
          "R66-0": 1
        }
      },
      {
        "id": "doorless-all",
        "name": "Doorless Rooms, All Sizes",
        "file": "pdf/Dungeon Tiles - Doorless Rooms All Sizes.pdf",
        "cut_guide": "pdf/Dungeon Tiles - Doorless Rooms All Sizes Cut Guide.pdf",
        "double_sided": false,
        "sheets": 10,
        "pieces": [
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              0,
              4
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 1,
            "at": [
              4,
              4
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 1,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 2,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 2,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 2,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "R45-0"
            ],
            "sheet": 2,
            "at": [
              4,
              5
            ]
          },
          {
            "faces": [
              "R46-0"
            ],
            "sheet": 3,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R46-0"
            ],
            "sheet": 3,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "R46-0"
            ],
            "sheet": 3,
            "at": [
              0,
              6
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 3,
            "at": [
              6,
              6
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 3,
            "at": [
              7,
              6
            ]
          },
          {
            "faces": [
              "R47-0"
            ],
            "sheet": 4,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R47-0"
            ],
            "sheet": 4,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              0,
              7
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              4,
              7
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 4,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "R48-0"
            ],
            "sheet": 5,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R48-0"
            ],
            "sheet": 5,
            "at": [
              4,
              0
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 5,
            "at": [
              0,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 5,
            "at": [
              4,
              8
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 5,
            "at": [
              0,
              9
            ]
          },
          {
            "faces": [
              "H5-S4"
            ],
            "sheet": 5,
            "at": [
              4,
              9
            ]
          },
          {
            "faces": [
              "R55-0"
            ],
            "sheet": 6,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R55-0"
            ],
            "sheet": 6,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 6,
            "at": [
              5,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 6,
            "at": [
              5,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 6,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 6,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 6,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 6,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R56-0"
            ],
            "sheet": 7,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R56-0"
            ],
            "sheet": 7,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 7,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 7,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 7,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 7,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R57-0"
            ],
            "sheet": 8,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R57-0"
            ],
            "sheet": 8,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 8,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 8,
            "at": [
              7,
              5
            ]
          },
          {
            "faces": [
              "R58-0"
            ],
            "sheet": 9,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R58-0"
            ],
            "sheet": 9,
            "at": [
              0,
              5
            ]
          },
          {
            "faces": [
              "R66-0"
            ],
            "sheet": 10,
            "at": [
              0,
              0
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 10,
            "at": [
              0,
              6
            ]
          },
          {
            "faces": [
              "R44-0"
            ],
            "sheet": 10,
            "at": [
              4,
              6
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 10,
            "at": [
              6,
              0
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 10,
            "at": [
              6,
              5
            ]
          },
          {
            "faces": [
              "H5-S5"
            ],
            "sheet": 10,
            "at": [
              7,
              0
            ]
          },
          {
            "faces": [
              "H5-S1"
            ],
            "sheet": 10,
            "at": [
              7,
              5
            ]
          }
        ],
        "faces_available": {
          "H5-S1": 2,
          "H5-S4": 16,
          "H5-S5": 14,
          "R44-0": 6,
          "R45-0": 4,
          "R46-0": 3,
          "R47-0": 2,
          "R48-0": 2,
          "R55-0": 2,
          "R56-0": 2,
          "R57-0": 2,
          "R58-0": 2,
          "R66-0": 1
        }
      }
    ]
  };
})();
