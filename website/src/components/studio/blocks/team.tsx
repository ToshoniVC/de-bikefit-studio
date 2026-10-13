import { initialsFor } from '@/lib/studio/initials';
import { StudioImage, hasImage } from '../studio-image';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `team` — one profile per person: portrait, name, role and a short bio.
 *
 * Without a real portrait the card shows the person's initials in the brand
 * palette; a generated image is never used as somebody's portrait. The
 * initials are decorative (the name is right below), so they are hidden from
 * assistive technology. `internalNote` is for editors and is never rendered.
 *
 * Names are `<h3>` under the section title, and `<h2>` when the section has
 * no title of its own (the profiles follow "Ons team" directly) or owns the
 * page's `<h1>`.
 */
export function TeamBlock({ data, anchor, headingLevel, locale }: BlockProps<'team'>) {
  const NameHeading = headingLevel === 1 || !data.title ? 'h2' : 'h3';

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      lede={data.lede}
      headingLevel={headingLevel}
    >
      {data.members.length > 0 ? (
        <ul className="studio-team">
          {data.members.map((member, index) => (
            <li key={`${member.name}-${index}`} className="studio-team__member">
              <div className="studio-team__portrait">
                {hasImage(member.image) ? (
                  <StudioImage
                    image={member.image}
                    locale={locale}
                    sizes="(max-width: 560px) 100vw, 33vw"
                  />
                ) : (
                  <span className="studio-team__initials" aria-hidden="true">
                    {initialsFor(member.name)}
                  </span>
                )}
              </div>
              <NameHeading className="studio-team__name">{member.name}</NameHeading>
              {member.role ? <p className="studio-team__role">{member.role}</p> : null}
              {member.bio.filter(Boolean).map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} className="studio-team__bio">
                  {paragraph}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
    </StudioSection>
  );
}
