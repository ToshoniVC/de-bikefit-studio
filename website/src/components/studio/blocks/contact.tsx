import { StudioButtonLink, splitArrow } from '../link';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `contact` — the studio's contact details.
 *
 * Every field is rendered only when it has a value. No street address, e-mail
 * address or opening-hours grid exists anywhere in the source material, so
 * those rows simply do not appear — the page never invents one, and neither
 * does the `LocalBusiness` JSON-LD.
 */
export function ContactBlock({ data, anchor, headingLevel }: BlockProps<'contact'>) {
  const address = data.addressLines.filter(Boolean);

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      lede={data.lede}
      headingLevel={headingLevel}
    >
      <div className="studio-contact">
        {data.phoneLabel && data.phoneHref ? (
          <div>
            <p className="studio-contact__label">Telefoon</p>
            <p className="studio-contact__value">
              <a href={data.phoneHref}>{data.phoneLabel}</a>
            </p>
          </div>
        ) : null}

        {data.email ? (
          <div>
            <p className="studio-contact__label">E-mail</p>
            <p className="studio-contact__value">
              <a href={`mailto:${data.email}`}>{data.email}</a>
            </p>
          </div>
        ) : null}

        {address.length > 0 || data.city ? (
          <div>
            <p className="studio-contact__label">Waar</p>
            <p className="studio-contact__value">
              {address.map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
              {data.city}
            </p>
          </div>
        ) : null}

        {data.hours ? (
          <div>
            <p className="studio-contact__label">Wanneer</p>
            <p className="studio-contact__value">{data.hours}</p>
          </div>
        ) : null}
      </div>

      {data.cta ? (
        <p className="studio-stack">
          <StudioButtonLink href={data.cta.href} external={data.cta.external} variant="primary">
            {splitArrow(data.cta.label)}
          </StudioButtonLink>
        </p>
      ) : null}

      {data.mapEmbedUrl ? (
        <div className="studio-stack">
          <iframe
            src={data.mapEmbedUrl}
            title="Kaart met de ligging van de studio"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            style={{ width: '100%', height: '360px', border: 0 }}
          />
        </div>
      ) : null}
    </StudioSection>
  );
}
