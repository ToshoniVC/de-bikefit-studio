import { describe, expect, it } from 'vitest';
import { QR_QUIET_ZONE, qrSvgPath } from './qr';

const URI =
  'otpauth://totp/De%20Bikefit%20Studio:contact%40toshoni.be?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=De+Bikefit+Studio&algorithm=SHA1&digits=6&period=30';

describe('qrSvgPath', () => {
  it('draws a square symbol with the quiet zone and only unit squares', () => {
    const { size, path } = qrSvgPath(URI);
    // Version n is 17 + 4n modules wide; plus the quiet zone on both sides.
    expect((size - 2 * QR_QUIET_ZONE - 17) % 4).toBe(0);
    const squares = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(squares.join('')).toBe(path);
    expect(squares.length).toBeGreaterThan(100);
    for (const square of squares) {
      const [, x, y] = /M(\d+) (\d+)/.exec(square)!.map(Number);
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(x).toBeLessThan(size - QR_QUIET_ZONE);
      expect(y).toBeLessThan(size - QR_QUIET_ZONE);
    }
  });

  it('is deterministic and draws the three finder patterns', () => {
    const first = qrSvgPath(URI);
    expect(qrSvgPath(URI)).toEqual(first);
    const q = QR_QUIET_ZONE;
    const inner = first.size - q - 7;
    for (const [x, y] of [
      [q, q],
      [inner, q],
      [q, inner],
    ]) {
      expect(first.path).toContain(`M${x} ${y}h1v1h-1z`);
    }
  });
});
