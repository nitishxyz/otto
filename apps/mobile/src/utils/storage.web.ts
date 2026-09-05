/**
 * Web preference storage. localStorage is not secure; do not store credentials here.
 */

export async function getItemAsync(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.error('Error reading from localStorage:', error);
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error('Error writing to localStorage:', error);
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error('Error deleting from localStorage:', error);
  }
}
