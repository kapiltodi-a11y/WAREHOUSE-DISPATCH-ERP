// ==============================================================================
// WAREHOUSE ERP CONFIGURATION
// Manages Supabase URL, Anon Key, Storage Bucket, and LocalStorage persistence
// ==============================================================================

const CONFIG_STORAGE_KEY = 'warehouse_erp_supabase_config';

export const AppConfig = {
    // Read from localStorage or default empty string
    supabaseUrl: localStorage.getItem(`${CONFIG_STORAGE_KEY}_url`) || '',
    supabaseAnonKey: localStorage.getItem(`${CONFIG_STORAGE_KEY}_key`) || '',
    storageBucketName: 'warehouse-photos',

    // Checks if valid Supabase credentials have been configured
    isConfigured() {
        return Boolean(
            this.supabaseUrl &&
            this.supabaseAnonKey &&
            this.supabaseUrl.trim().startsWith('https://') &&
            this.supabaseAnonKey.trim().length > 20
        );
    },

    // Save Supabase credentials to localStorage
    saveConfig(url, key) {
        this.supabaseUrl = (url || '').trim();
        this.supabaseAnonKey = (key || '').trim();
        localStorage.setItem(`${CONFIG_STORAGE_KEY}_url`, this.supabaseUrl);
        localStorage.setItem(`${CONFIG_STORAGE_KEY}_key`, this.supabaseAnonKey);
    },

    // Clear saved credentials
    clearConfig() {
        this.supabaseUrl = '';
        this.supabaseAnonKey = '';
        localStorage.removeItem(`${CONFIG_STORAGE_KEY}_url`);
        localStorage.removeItem(`${CONFIG_STORAGE_KEY}_key`);
    }
};
