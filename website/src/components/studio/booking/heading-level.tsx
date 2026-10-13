'use client';

import { createContext, useContext } from 'react';

/**
 * Tag for the booking widget's step and confirmation headings. They sit
 * under the booking section's title: `h3` below a section `<h2>`, and `h2`
 * when that section owns the page's `<h1>` — as on `/afspraak`, which opens
 * on "Kies je moment" — so the outline never skips a level.
 */
export type BookingHeadingTag = 'h2' | 'h3';

const BookingHeadingContext = createContext<BookingHeadingTag>('h3');

export function BookingHeadingLevel({
  tag,
  children,
}: {
  tag: BookingHeadingTag;
  children: React.ReactNode;
}) {
  return <BookingHeadingContext.Provider value={tag}>{children}</BookingHeadingContext.Provider>;
}

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & { 'data-step-heading'?: string };

/** A step or confirmation heading at the level the surrounding section sets. */
export function BookingHeading(props: HeadingProps) {
  return useContext(BookingHeadingContext) === 'h2' ? <h2 {...props} /> : <h3 {...props} />;
}
