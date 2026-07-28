/** @type {import('tailwindcss').Config} */
export default {
	darkMode: 'class',
	content: ['./src/**/*.{astro,js,ts,jsx,tsx}'],
	theme: {
		extend: {
			fontFamily: {
				mono: ['IBM Plex Mono', 'monospace'],
			},
			colors: {
				otto: {
					bg: 'rgb(var(--otto-bg) / <alpha-value>)',
					surface: 'rgb(var(--otto-surface) / <alpha-value>)',
					card: 'rgb(var(--otto-card) / <alpha-value>)',
					border: 'rgb(var(--otto-border) / <alpha-value>)',
					'border-light': 'rgb(var(--otto-border-light) / <alpha-value>)',
					text: 'rgb(var(--otto-text) / <alpha-value>)',
					muted: 'rgb(var(--otto-muted) / <alpha-value>)',
					dim: 'rgb(var(--otto-dim) / <alpha-value>)',
					accent: 'rgb(var(--otto-accent) / <alpha-value>)',
					'accent-light': 'rgb(var(--otto-accent-light) / <alpha-value>)',
					glow: 'var(--otto-glow)',
				},
				np: {
					edge: 'rgb(var(--np-border) / <alpha-value>)',
					shadow: 'rgb(var(--np-shadow) / <alpha-value>)',
					ink: 'rgb(var(--np-ink) / <alpha-value>)',
					blue: 'rgb(var(--np-blue) / <alpha-value>)',
					'blue-on': 'rgb(var(--np-blue-on) / <alpha-value>)',
					lime: 'rgb(var(--np-lime) / <alpha-value>)',
					'lime-on': 'rgb(var(--np-lime-on) / <alpha-value>)',
					yellow: 'rgb(var(--np-yellow) / <alpha-value>)',
					'yellow-on': 'rgb(var(--np-yellow-on) / <alpha-value>)',
					coral: 'rgb(var(--np-coral) / <alpha-value>)',
					'coral-on': 'rgb(var(--np-coral-on) / <alpha-value>)',
				},
			},
			animation: {
				'fade-in': 'fadeIn 0.6s ease-out forwards',
				'slide-up': 'slideUp 0.6s ease-out forwards',
				blink: 'blink 1s step-end infinite',
				'terminal-line': 'termLine 0.3s ease-out forwards',
			},
			keyframes: {
				fadeIn: {
					from: { opacity: '0' },
					to: { opacity: '1' },
				},
				slideUp: {
					from: { opacity: '0', transform: 'translateY(20px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
				blink: {
					'0%, 100%': { opacity: '1' },
					'50%': { opacity: '0' },
				},
				termLine: {
					from: { opacity: '0', transform: 'translateY(4px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
			},
		},
	},
	plugins: [],
};
