# Untuned effort-9 screen

Measured producer 9c77134ffca7d6cc880b1f33cf856b7044b1e7d9179856bae4cbc54398ba013e. This is the single completed screen; its encode timings and streams were not replaced after the bounded-fallback correctness repair. Both independent decoders and focused tests qualify the preserved streams on the repaired source.

| Peer | Metric | Mean BD-rate | Images | Full band |
| --- | --- | ---: | ---: | ---: |
| jsquash | SSIMULACRA2 | -4.26% | 16 | 2 |
| jsquash | Butteraugli max | +23.42% | 16 | 3 |
| jsquash | Butteraugli 3-norm | +11.32% | 16 | 0 |
| vips | SSIMULACRA2 | -5.62% | 16 | 1 |
| vips | Butteraugli max | +3.70% | 16 | 0 |
| vips | Butteraugli 3-norm | +5.03% | 16 | 0 |
| purejsimage | SSIMULACRA2 | -0.35% | 16 | 2 |
| purejsimage | Butteraugli max | -0.51% | 16 | 3 |
| purejsimage | Butteraugli 3-norm | -0.28% | 16 | 0 |

Speed distribution and ratio data:

```json
{
  "presetSpeed": {
    "points": 16,
    "ownEffortSeven": {
      "count": 16,
      "mean": 2421.1944568750005,
      "median": 1422.1450610000002,
      "p90": 3750.176371000001,
      "worst": 13049.691114000001
    },
    "ownEffortNine": {
      "count": 16,
      "mean": 17106.653518375,
      "median": 17723.85168,
      "p90": 22128.6182905,
      "worst": 25323.860839999994
    },
    "jsquashEffortNine": {
      "count": 16,
      "mean": 1550.504158125,
      "median": 1524.7977400000018,
      "p90": 1713.6941279999992,
      "worst": 1788.6258720000005
    },
    "versusOwnSeven": 12.462759366851957,
    "versusJsquashNine": 11.623739473800622,
    "rows": [
      {
        "id": "im26-3012",
        "effortSevenMs": 1435.0677840000003,
        "effortNineMs": 20758.161592999997,
        "jsquashNineMs": 1527.946637000001
      },
      {
        "id": "im26-1052",
        "effortSevenMs": 1412.5235350000003,
        "effortNineMs": 19120.292346999995,
        "jsquashNineMs": 1751.2305930000002
      },
      {
        "id": "im26-1610",
        "effortSevenMs": 1363.1360520000003,
        "effortNineMs": 17293.425995000005,
        "jsquashNineMs": 1676.1576629999981
      },
      {
        "id": "im26-3312",
        "effortSevenMs": 13049.691114000001,
        "effortNineMs": 25323.860839999994,
        "jsquashNineMs": 1430.7112849999976
      },
      {
        "id": "im26-1002",
        "effortSevenMs": 1384.745911,
        "effortNineMs": 20545.120839999996,
        "jsquashNineMs": 1575.377131000001
      },
      {
        "id": "im26-3014",
        "effortSevenMs": 3297.235660000001,
        "effortNineMs": 12820.807488999999,
        "jsquashNineMs": 1473.399019999997
      },
      {
        "id": "im26-1026",
        "effortSevenMs": 1431.766587,
        "effortNineMs": 16442.061996999997,
        "jsquashNineMs": 1521.6488430000027
      },
      {
        "id": "im26-1626",
        "effortSevenMs": 1335.316217,
        "effortNineMs": 17880.145396,
        "jsquashNineMs": 1434.729726999998
      },
      {
        "id": "im26-2002",
        "effortSevenMs": 1373.98151,
        "effortNineMs": 10651.612157000003,
        "jsquashNineMs": 1473.8613530000002
      },
      {
        "id": "im26-2004",
        "effortSevenMs": 1498.3203169999997,
        "effortNineMs": 12170.534714000001,
        "jsquashNineMs": 1613.7837580000014
      },
      {
        "id": "im26-1622",
        "effortSevenMs": 1353.72721,
        "effortNineMs": 18709.085531999997,
        "jsquashNineMs": 1508.8960110000007
      },
      {
        "id": "im26-1210",
        "effortSevenMs": 1491.1594170000003,
        "effortNineMs": 23499.074988,
        "jsquashNineMs": 1788.6258720000005
      },
      {
        "id": "im26-1634",
        "effortSevenMs": 1379.611195,
        "effortNineMs": 10432.911996999996,
        "jsquashNineMs": 1454.4522309999993
      },
      {
        "id": "im26-3000",
        "effortSevenMs": 1242.9204259999997,
        "effortNineMs": 18661.353014999993,
        "jsquashNineMs": 1544.2816380000004
      },
      {
        "id": "im26-3306",
        "effortSevenMs": 1486.7912930000002,
        "effortNineMs": 11830.44943,
        "jsquashNineMs": 1550.798605
      },
      {
        "id": "im26-2012",
        "effortSevenMs": 4203.117082000001,
        "effortNineMs": 17567.557964,
        "jsquashNineMs": 1482.1661630000017
      }
    ],
    "policy": "Same sixteen inputs, own distance 2 and public jSquash quality 80. Fresh one-worker screen timings at these declared presets. Quality-matched compression is assessed separately through BD-rate; no claim that equal knob numbers give identical quality."
  },
  "effortSevenSpeed": {
    "count": 80,
    "mean": 2193.5827858125,
    "median": 1338.1697574999998,
    "p90": 4211.093016400001,
    "worst": 13194.611462
  },
  "effortNineSpeedRatios": {
    "versusOwnEffortSeven": 13.703476226184254,
    "versusJsquashEffortNine": 10.694499286808796
  },
  "speed": [
    {
      "engine": "purejsimage",
      "effort": 9,
      "lab": {
        "count": 80,
        "mean": 17910.266443912493,
        "median": 18337.577458499996,
        "p90": 21694.2285157,
        "worst": 29969.394577000003
      },
      "watch": null
    },
    {
      "engine": "jsquash",
      "effort": 9,
      "lab": {
        "count": 272,
        "mean": 2160.5608878639714,
        "median": 1714.6737745,
        "p90": 2995.666930999999,
        "worst": 10387.038793
      },
      "watch": null
    },
    {
      "engine": "vips",
      "effort": 7,
      "lab": {
        "count": 144,
        "mean": 260.0739676319445,
        "median": 231.94614299999967,
        "p90": 393.15359330000007,
        "worst": 642.2379899999999
      },
      "watch": null
    }
  ]
}
```

All 80 own streams pass native and Rust decoders. The slow tier is untuned. Partial coverage remains explicit. Own effort-7/9 settings match; cross-peer distributions use different public quality ladders.
