/**
 * The enrolment QR code, from the path `qrSvgPath()` (`src/lib/cms/mfa/qr.ts`)
 * computed on the server. Plain SVG elements, no `dangerouslySetInnerHTML`.
 * Dark modules on the lightest bone token, with the quiet zone included in
 * the path's coordinate space, so authenticator apps read it reliably.
 */
export function MfaQrCode({ size, path }: { size: number; path: string }) {
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR-code om je authenticator-app te koppelen"
      shapeRendering="crispEdges"
      className="h-56 w-56 max-w-full border border-border bg-ds-bone-50"
    >
      <path d={path} className="fill-ds-ink-900" />
    </svg>
  );
}
