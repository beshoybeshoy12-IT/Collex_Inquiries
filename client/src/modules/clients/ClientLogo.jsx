import { useTranslation } from 'react-i18next';
import { localisedName } from '../../i18n';
import { useClientLogoUrl } from '../../hooks/useClients';

/**
 * A client's logo, or its initials on a tinted tile when it has none.
 *
 * The tile is white behind the image on purpose: logos are drawn for white
 * paper, and a transparent PNG of black lettering vanishes on the dark theme.
 *
 * @param {{ client: object, size?: number, className?: string }} props
 */
export default function ClientLogo({ client, size = 40, className = '' }) {
  const { i18n } = useTranslation();
  const url = useClientLogoUrl(client);
  const name = client ? localisedName(client, i18n.language) : '';

  if (url) {
    return (
      <span className={`client-logo has-image ${className}`} style={{ width: size, height: size }}>
        <img src={url} alt={name} />
      </span>
    );
  }

  const initials = (client?.nameEn || client?.nameAr || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <span
      className={`client-logo ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
