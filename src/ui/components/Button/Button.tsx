"use client";
/*
 * Documentation:
 * Button — https://app.subframe.com/00773a7ca3a0/library?component=Button_44386fd8-e23c-419b-aee2-66e3e722375b
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface ButtonRootProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  disabled?: boolean;
  children?: React.ReactNode;
  variant?: "primary" | "ghost" | "light";
  size?: "default" | "big";
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const ButtonRoot = React.forwardRef<HTMLButtonElement, ButtonRootProps>(
  function ButtonRoot(
    {
      disabled = false,
      children,
      variant = "primary",
      size = "default",
      className,
      type = "button",
      ...otherProps
    }: ButtonRootProps,
    ref
  ) {
    return (
      <button
        className={SubframeUtils.twClassNames(
          "group/44386fd8 flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-solid border-brand-primary bg-brand-primary px-[22px] py-3 text-left hover:bg-navy hover:border-navy disabled:cursor-default disabled:opacity-50",
          {
            "px-7 py-[15px]": size === "big",
            "border border-solid border-cream bg-cream hover:bg-stone hover:border-stone":
              variant === "light",
            "border border-solid border-neutral-900 bg-transparent hover:bg-stone":
              variant === "ghost",
          },
          className
        )}
        ref={ref}
        type={type}
        disabled={disabled}
        {...otherProps}
      >
        {children ? (
          <span
            className={SubframeUtils.twClassNames(
              "whitespace-nowrap font-['Plus_Jakarta_Sans'] text-[16px] font-[600] leading-[22px] text-white",
              {
                "text-[17px] leading-[24px] tracking-normal": size === "big",
                "text-navy": variant === "light" || variant === "ghost",
              }
            )}
          >
            {children}
          </span>
        ) : null}
      </button>
    );
  }
);

export const Button = ButtonRoot;
