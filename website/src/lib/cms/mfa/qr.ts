import { encode } from 'uqr';

/**
 * QR code for the enrolment `otpauth://` URI, drawn locally: no image service,
 * no third-party request, the secret never leaves our server and the browser.
 * `uqr` (zero dependencies) builds the module matrix; this turns it into one
 * SVG path so the client renders `<path d={…}>` with no `dangerouslySetInnerHTML`.
 *
 * ECC level M and a four-module quiet zone (the QR specification's minimum)
 * scan reliably from a laptop screen with 1Password and phone apps alike.
 */

export const QR_QUIET_ZONE = 4;

export type QrPath = {
  /** Width and height in modules, quiet zone included: the SVG `viewBox` is `0 0 size size`. */
  size: number;
  /** One `M x y h1 v1 h-1 z` square per dark module. */
  path: string;
};

export function qrSvgPath(text: string): QrPath {
  const { data, size } = encode(text, { ecc: 'M', border: QR_QUIET_ZONE });
  let path = '';
  for (let y = 0; y < size; y += 1) {
    const row = data[y];
    for (let x = 0; x < size; x += 1) {
      if (row[x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}
