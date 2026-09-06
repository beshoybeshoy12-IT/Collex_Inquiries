/**
 * The Collex Inquiries mark.
 *
 * Drawn rather than shipped as an image, for three reasons that matter here:
 * it inherits `currentColor`, so the same component works white-on-blue in the
 * sidebar tile and solid on a light background without a second asset; it stays
 * sharp at 20px and at 96px; and a print stylesheet or a dark theme cannot get
 * a stale raster.
 *
 * The geometry is two concentric arcs spiralling inward to a centre dot, each
 * with its gap on the opposite side. It reads as a "C" at small sizes, which is
 * the point.
 *
 * `strokeWidth` is expressed in the 24-unit viewBox, so it scales with the mark
 * instead of thinning out as the icon grows.
 */
export default function Logo({ size = 32, className = '', title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {/* Outer arc — gap at the upper right. */}
      <path
        d="M 21.40 15.42 A 10 10 0 1 1 17.00 3.34"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Inner arc — gap on the opposite side, which is what makes it read as
          a spiral rather than as two rings. */}
      <path
        d="M 6.83 10.12 A 5.5 5.5 0 1 1 9.25 16.76"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Centre. */}
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
