export default function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  className = "",
  ...props
}) {
  const variants = {
    primary: "bg-[#59643a] text-white hover:bg-[#46512d]",
    secondary: "border border-[#e1e4dc] bg-white text-[#454b3f] hover:bg-[#f7f8f3]",
    danger: "text-red-700 hover:bg-red-50"
  };
  const sizes = {
    sm: "min-h-10 px-3 text-xs",
    md: "min-h-11 px-4 text-sm",
    icon: "size-11"
  };
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${sizes[size] || sizes.md} ${variants[variant] || variants.primary} ${className}`}
      disabled={disabled || loading}
    >
      {loading && <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
}
