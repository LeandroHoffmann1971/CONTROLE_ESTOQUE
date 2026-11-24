export default function Badge({ children, variant = "neutral", className = "", ...props }) {
  const variants = {
    neutral: "bg-[#f0f2e7] text-[#59643a]",
    success: "bg-green-50 text-green-700",
    danger: "bg-red-50 text-red-700",
    muted: "bg-gray-100 text-gray-700"
  };
  return (
    <span
      {...props}
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${variants[variant] || variants.neutral} ${className}`}
    >
      {children}
    </span>
  );
}
