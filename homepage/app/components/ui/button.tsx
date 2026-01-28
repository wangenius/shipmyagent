import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium uppercase tracking-widest transition-all duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline focus-visible:outline-3 focus-visible:outline-black focus-visible:outline-offset-3",
  {
    variants: {
      variant: {
        default:
          "bg-black text-[#fff] border-none hover:bg-[#fff] hover:text-black hover:outline hover:outline-2 hover:outline-black",
        destructive:
          "bg-black text-[#fff] hover:bg-[#fff] hover:text-black hover:outline hover:outline-2 hover:outline-black",
        outline:
          "border-2 border-black bg-transparent text-black hover:bg-black hover:text-[#fff]",
        secondary:
          "bg-[#F5F5F5] text-black border border-[#E5E5E5] hover:bg-black hover:text-[#fff] hover:border-black",
        ghost: "hover:bg-[#F5F5F5] hover:text-black",
        link: "text-black underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-8 py-4",
        sm: "h-10 px-6 text-xs",
        lg: "h-14 px-10",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
