# Calibration screenshot analyzer.
# Usage: powershell -File analyze.ps1 -Image path\to\screenshot.png
# Finds the white 200x12 ruler bar to derive scale + canvas origin, then reports
# the bounding box (in canvas UI units) and mean RGB of every flat-color marker.
param([Parameter(Mandatory = $true)][string]$Image)

$src = @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Cal {
    // Classification by channel pattern, tolerant of the game's output transform.
    // Returns a label id, 0 = unclassified.
    static int Classify(int r, int g, int b) {
        bool hiR = r > 200, hiG = g > 230, hiB = b > 200;
        bool loR = r < 80, loG = g < 80, loB = b < 80;
        if (r > 245 && g > 245 && b > 245) return 1;              // white
        if (hiR && loG && loB) return 2;                          // red
        if (loR && g > 200 && loB) return 3;                      // green
        if (loR && loG && hiB) return 4;                          // blue
        if (hiR && hiG && loB) return 5;                          // yellow
        if (hiR && loG && hiB) return 6;                          // magenta
        if (loR && g > 200 && hiB) return 7;                      // cyan
        if (hiR && g >= 90 && g <= 215 && loB) return 8;          // orange (1 .5 0)
        if (r >= 90 && r <= 215 && loG && hiB) return 9;          // purple (.5 0 1)
        // dark colored backgrounds (all channels < 200, one clearly dominant pair pattern)
        if (r < 200 && g < 90 && b < 90 && r > 55 && r > g + 30 && r > b + 30) return 10; // dark red box bg (.4 .1 .1)
        if (b < 200 && r < 90 && g < 90 && b > 55 && b > r + 30 && b > g + 30) return 11; // dark blue (.1 .1 .3/.4)
        if (g < 200 && r < 90 && b < 90 && g > 55 && g > r + 25 && g > b + 25) return 12; // dark green (.1 .25 .1)
        if (r > 90 && r < 200 && loG && b > 90 && b < 200 && Math.Abs(r - b) < 30) return 13; // dark magenta (.5 0 .5)
        if (loR && g > 60 && g < 200 && b > 60 && b < 200 && Math.Abs(g - b) < 30) return 14; // teal (0 .4 .4)
        int mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
        if (mx - mn < 14 && mx > 25) {                            // gray family, bucket by value
            if (mx < 70) return 20;   // darkest gray bucket
            if (mx < 105) return 21;
            if (mx < 150) return 22;
            if (mx < 200) return 23;
        }
        return 0;
    }

    public static string[] Names = { "?", "white", "red", "green", "blue", "yellow", "magenta", "cyan",
        "orange", "purple", "bg-darkred", "bg-darkblue", "bg-darkgreen", "bg-darkmagenta", "bg-teal",
        "?", "?", "?", "?", "?", "gray20", "gray21", "gray22", "gray23" };

    public static List<string> Run(string path) {
        var bmp = new Bitmap(path);
        int w = bmp.Width, h = bmp.Height;
        var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var buf = new byte[bd.Stride * h];
        Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
        bmp.UnlockBits(bd);

        var label = new byte[w * h];
        for (int y = 0; y < h; y++) {
            int row = y * bd.Stride;
            for (int x = 0; x < w; x++) {
                int i = row + x * 4;
                label[y * w + x] = (byte)Classify(buf[i + 2], buf[i + 1], buf[i]);
            }
        }

        // connected components per label (4-connectivity, BFS)
        var comp = new int[w * h];
        var results = new List<string>();
        var boxes = new List<int[]>(); // label, x0,y0,x1,y1, area, sumR,sumG,sumB
        int nc = 0;
        var queue = new Queue<int>();
        for (int p = 0; p < w * h; p++) {
            if (label[p] == 0 || comp[p] != 0) continue;
            nc++;
            byte L = label[p];
            int x0 = w, y0 = h, x1 = 0, y1 = 0; long area = 0, sr = 0, sg = 0, sb = 0;
            comp[p] = nc; queue.Enqueue(p);
            while (queue.Count > 0) {
                int q = queue.Dequeue();
                int qx = q % w, qy = q / w;
                if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
                if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
                area++;
                int bi = qy * bd.Stride + qx * 4;
                sr += buf[bi + 2]; sg += buf[bi + 1]; sb += buf[bi];
                if (qx > 0 && comp[q - 1] == 0 && label[q - 1] == L) { comp[q - 1] = nc; queue.Enqueue(q - 1); }
                if (qx < w - 1 && comp[q + 1] == 0 && label[q + 1] == L) { comp[q + 1] = nc; queue.Enqueue(q + 1); }
                if (qy > 0 && comp[q - w] == 0 && label[q - w] == L) { comp[q - w] = nc; queue.Enqueue(q - w); }
                if (qy < h - 1 && comp[q + w] == 0 && label[q + w] == L) { comp[q + w] = nc; queue.Enqueue(q + w); }
            }
            int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            double fill = (double)area / (bw * bh);
            if (area >= 40 && fill >= 0.55)
                boxes.Add(new int[] { L, x0, y0, x1, y1, (int)area, (int)(sr / area), (int)(sg / area), (int)(sb / area) });
        }

        // scale/origin from the white ruler bar: aspect ~16.7, widest such component
        double scale = 0; double ox = 0, oy = 0;
        int[] ruler = null;
        foreach (var b in boxes) {
            if (b[0] != 1) continue;
            int bw = b[3] - b[1] + 1, bh = b[4] - b[2] + 1;
            double aspect = (double)bw / bh;
            if (aspect > 13 && aspect < 20 && (ruler == null || bw > ruler[3] - ruler[1]))
                ruler = b;
        }
        if (ruler != null) {
            scale = (ruler[3] - ruler[1] + 1) / 200.0;
            ox = ruler[1] - 20 * scale;
            oy = ruler[2] - 12 * scale;
            results.Add(string.Format("RULER px=({0},{1},{2}x{3}) scale={4:F4} canvas-origin=({5:F1},{6:F1})",
                ruler[1], ruler[2], ruler[3] - ruler[1] + 1, ruler[4] - ruler[2] + 1, scale, ox, oy));
        } else {
            results.Add("RULER NOT FOUND - reporting raw pixel coords, scale=1");
            scale = 1;
        }

        boxes.Sort((a, b) => a[2] != b[2] ? a[2].CompareTo(b[2]) : a[1].CompareTo(b[1]));
        foreach (var b in boxes) {
            double cx = (b[1] - ox) / scale, cy = (b[2] - oy) / scale;
            double cw = (b[3] - b[1] + 1) / scale, ch = (b[4] - b[2] + 1) / scale;
            // skip components entirely outside the canvas (map, HUD)
            if (cx < -30 || cy < -30 || cx > 980 || cy > 700) continue;
            results.Add(string.Format("{0,-14} canvas=({1,7:F1},{2,7:F1} {3,6:F1}x{4,-6:F1}) px=({5},{6}) area={7} rgb=({8},{9},{10})",
                Names[b[0]], cx, cy, cw, ch, b[1], b[2], b[5], b[6], b[7], b[8]));
        }
        return results;
    }
}
"@

Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing
[Cal]::Run((Resolve-Path $Image).Path) | ForEach-Object { $_ }
