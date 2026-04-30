"use client";

/**
 * Legacy animated-background — neutralized.
 *
 * The marketing hero used to render three randomly-translating, rotating
 * blur blobs (violet / fuchsia / cyan) behind the title. The redesign
 * drops the ornament. The CSS in `globals.css` already hides any
 * `.wrapper > .blur` children, but to avoid running orphan motion code
 * we now render only the empty wrapper itself. Existing imports and
 * call sites continue to work unchanged.
 */
const AnimatedBackground: React.FC = () => {
  return <div className="wrapper" aria-hidden="true" />;
};

export { AnimatedBackground };
