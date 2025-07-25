// Utility function
function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function createInput({
  type = "text",
  className = "",
  ...props
}) {
  const input = document.createElement('input');
  
  const baseClasses = "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  
  input.type = type;
  input.className = cn(baseClasses, className);
  
  // Apply properties
  Object.keys(props).forEach(key => {
    if (key.startsWith('on') && typeof props[key] === 'function') {
      const event = key.slice(2).toLowerCase();
      input.addEventListener(event, props[key]);
    } else {
      input[key] = props[key];
    }
  });
  
  return input;
}