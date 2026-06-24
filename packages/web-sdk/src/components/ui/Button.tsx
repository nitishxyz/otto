import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary' | 'ghost';
	size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className = '', variant = 'primary', size = 'md', ...props }, ref) => {
		const baseStyles =
			'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed';

		const variants = {
			primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
			secondary:
				'bg-muted text-foreground hover:bg-muted/80 border border-border',
			ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
		};

		const sizes = {
			sm: 'px-3 py-1.5 text-sm',
			md: 'px-4 py-2 text-sm',
			lg: 'px-6 py-3 text-base',
			icon: 'w-10 h-10 p-0',
		};

		return (
			<button
				ref={ref}
				className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
				{...props}
			/>
		);
	},
);

Button.displayName = 'Button';
