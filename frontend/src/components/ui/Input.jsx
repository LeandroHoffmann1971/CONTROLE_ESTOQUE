export default function Input({ error, className = "", ...props }) {
  const describedBy = [props["aria-describedby"], error ? props.id && `${props.id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
  return (
    <>
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={`min-h-11 w-full min-w-0 rounded-lg border border-[#dfe2d7] bg-white px-3 text-base text-[#20251d] outline-none focus:border-[#75804c] disabled:opacity-60 ${className}`}
      />
      {error && <span className="mt-1 block text-sm text-red-800" id={props.id ? `${props.id}-error` : undefined}>{error}</span>}
    </>
  );
}
