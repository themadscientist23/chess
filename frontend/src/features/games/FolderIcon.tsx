interface FolderIconProps {
  className?: string;
}

export function FolderIcon({ className }: FolderIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 6.5a2 2 0 0 1 2-2h3.7c.5 0 1 .2 1.4.6l1.3 1.3c.3.4.8.6 1.3.6h6.3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2V6.5z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
