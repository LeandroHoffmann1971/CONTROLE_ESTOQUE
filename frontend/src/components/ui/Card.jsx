export default function Card({ as: Element = "article", className = "", children, ...props }) {
  return (
    <Element
      {...props}
      className={`min-w-0 rounded-xl border border-[#e5e7df] bg-white p-4 shadow-sm sm:p-5 ${className}`}
    >
      {children}
    </Element>
  );
}
