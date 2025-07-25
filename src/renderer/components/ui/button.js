// Utility function since we can't use twMerge in Electron without bundler
function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

// Button component styles
const buttonVariants = {
  variant: {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    outline: "border border-input hover:bg-accent hover:text-accent-foreground",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "underline-offset-4 hover:underline text-primary"
  },
  size: {
    default: "h-10 py-2 px-4",
    sm: "h-9 px-3 rounded-md",
    lg: "h-11 px-8 rounded-md",
    icon: "h-10 w-10"
  }
};

export function createButton({
  variant = "default",
  size = "default",
  className = "",
  ...props
}) {
  const button = document.createElement('button');
  
  const baseClasses = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background";
  
  const variantClasses = buttonVariants.variant[variant] || buttonVariants.variant.default;
  const sizeClasses = buttonVariants.size[size] || buttonVariants.size.default;
  
  button.className = cn(baseClasses, variantClasses, sizeClasses, className);
  
  // Apply properties
  Object.keys(props).forEach(key => {
    if (key === 'onClick') {
      button.addEventListener('click', props[key]);
    } else {
      button[key] = props[key];
    }
  });
  
  return button;
}