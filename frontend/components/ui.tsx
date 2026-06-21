import * as React from "react";

import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "secondary" | "ghost" | "destructive" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-mint text-ink hover:bg-mint/90",
        variant === "secondary" && "border border-line bg-rail text-zinc-100 hover:bg-[#303743]",
        variant === "ghost" && "text-zinc-300 hover:bg-rail hover:text-white",
        variant === "destructive" && "bg-coral text-white hover:bg-coral/90",
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-panel shadow-sm", className)} {...props} />;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("w-full rounded-md border border-line bg-[#12151b] px-3 py-2.5 text-sm outline-none transition focus:border-mint", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-sm font-medium text-zinc-300", className)} {...props} />;
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-md border border-line bg-rail px-2 py-1 text-xs text-zinc-300", className)} {...props} />;
}
