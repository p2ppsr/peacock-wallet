import React, { useId } from 'react'

interface LogoProps {
  className?: string
  rotate?: boolean
  size?: string | number
  color?: string
  title?: string
}

/**
 * Peacock's mark combines a feather, an eye and a subtle P-shaped spine.
 * It is deliberately simple enough to remain legible in tray and favicon sizes.
 */
const Logo: React.FC<LogoProps> = ({
  className,
  rotate = false,
  size = '100%',
  color,
  title = 'Peacock'
}) => {
  const id = useId().replace(/:/g, '')
  const primary = color ?? '#2AB9A7'
  const secondary = color ?? '#5B8FD0'

  return (
    <svg
      aria-label={title}
      className={className ? `peacock-mark ${className}` : 'peacock-mark'}
      role="img"
      style={{
        width: size,
        height: size,
        transformOrigin: 'center',
        animation: rotate ? 'peacock-mark-breathe 5s ease-in-out infinite' : undefined
      }}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <style>{`
        @keyframes peacock-mark-breathe {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .peacock-mark { animation: none !important; }
        }
      `}</style>
      <defs>
        <linearGradient id={`${id}-plume`} x1="24" y1="98" x2="98" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor={primary} />
          <stop offset="1" stopColor={secondary} />
        </linearGradient>
        <linearGradient id={`${id}-eye`} x1="50" y1="68" x2="86" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#72E4CF" />
          <stop offset="1" stopColor="#88B8F0" />
        </linearGradient>
      </defs>

      <path
        d="M24 96C27 56 48 24 94 20C101 52 88 86 42 99C35 101 28 100 24 96Z"
        fill={`url(#${id}-plume)`}
        fillOpacity="0.16"
        stroke={`url(#${id}-plume)`}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M25 98C44 81 60 65 89 28"
        stroke={`url(#${id}-plume)`}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M52 57C58 43 72 36 84 42C86 55 77 67 63 68C57 67 53 63 52 57Z"
        fill={`url(#${id}-eye)`}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="70" cy="54" r="7" fill="currentColor" />
      <circle cx="73" cy="51" r="2.5" fill="white" fillOpacity="0.9" />
      <path d="M38 87C49 84 58 83 67 84" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
      <path d="M45 76C53 73 61 72 72 73" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

export default Logo
