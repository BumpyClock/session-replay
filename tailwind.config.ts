import type { Config } from 'tailwindcss'

const config: Config = {
    darkMode: ['class'],
    content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './src/**/*.css',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: [
  				'Inter',
  				'Avenir Next',
  				'Avenir',
  				'Segoe UI',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'IBM Plex Mono',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'monospace'
  			]
  		},
  		borderRadius: {
  			xs: '0.1875rem',
  			sm: '0.375rem',
  			md: '0.625rem',
  			lg: '0.75rem'
  		},
  		colors: {
  			border: 'var(--color-border)',
  			input: 'var(--color-border)',
  			ring: 'var(--color-ring)',
  			background: 'var(--color-background)',
  			foreground: 'var(--color-foreground)',
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		}
  	}
  },
  plugins: [],
}

export default config
