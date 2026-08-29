import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Variantes de botão no padrão OriginUI/shadcn — reutilizadas em toda a aplicação.
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm shadow-accent/20",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-secondary",
        ghost: "bg-transparent text-foreground hover:bg-secondary",
      },
      // Em telas de toque os tamanhos compactos sobem para 44px, o mínimo
      // confortável para um dedo. `pointer-coarse` mede o ponteiro, não a
      // largura: um botão pequeno continua pequeno no desktop, onde o mouse
      // acerta 36px sem esforço.
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-xs pointer-coarse:h-11 pointer-coarse:px-5 pointer-coarse:text-sm",
        lg: "h-12 px-8 text-base",
        icon: "size-9 rounded-full p-0 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
