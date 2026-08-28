'use client';
import React from 'react';
import { Text, View } from 'react-native';
import { tva } from '@gluestack-ui/utils/nativewind-utils';
import {
  withStyleContext,
  useStyleContext,
} from '@gluestack-ui/utils/nativewind-utils';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';
const SCOPE = 'BADGE';

const badgeStyle = tva({
  base: 'flex-row items-center justify-center rounded-sm px-2 py-0.5',
  variants: {
    variant: {
      default: 'bg-primary',
      secondary: 'bg-secondary',
      destructive:
        'bg-destructive dark:bg-destructive/60',
      outline: 'border border-border dark:border-border/90 bg-transparent',
    },
  },
});

const badgeTextStyle = tva({
  base: 'text-xs font-medium tracking-normal uppercase',
  parentVariants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-white',
      outline: 'text-foreground',
    },
  },
});

const ContextView = withStyleContext(View, SCOPE);

type IBadgeProps = React.ComponentPropsWithoutRef<typeof ContextView> &
  VariantProps<typeof badgeStyle>;
function Badge({
  children,
  variant = 'default',
  className,
  ...props
}: { className?: string } & IBadgeProps) {
  return (
    <ContextView
      className={badgeStyle({ variant, class: className })}
      {...props}
      context={{ variant }}
    >
      {children}
    </ContextView>
  );
}

type IBadgeTextProps = React.ComponentPropsWithoutRef<typeof Text> &
  VariantProps<typeof badgeTextStyle>;

const BadgeText = React.forwardRef<
  React.ComponentRef<typeof Text>,
  IBadgeTextProps
>(function BadgeText({ children, className, ...props }, ref) {
  const { variant: parentVariant } = useStyleContext(SCOPE);
  return (
    <Text
      ref={ref}
      className={badgeTextStyle({
        parentVariants: {
          variant: parentVariant,
        },
        class: className,
      })}
      {...props}
    >
      {children}
    </Text>
  );
});

Badge.displayName = 'Badge';
BadgeText.displayName = 'BadgeText';

export { Badge, BadgeText };
