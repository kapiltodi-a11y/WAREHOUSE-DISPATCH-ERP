// ==============================================================================
// SUPABASE CLIENT & CLOUD STORAGE HELPER
// Initializes Supabase JS client and handles file uploads with offline fallback
// ==============================================================================

import { AppConfig } from './config.js';

let supabaseInstance = null;

export const SupabaseManager = {
    // Get or initialize the Supabase client instance
    getClient() {
        if (!AppConfig.isConfigured()) {
            return null;
        }

        if (supabaseInstance) {
            return supabaseInstance;
        }

        if (window.supabase && typeof window.supabase.createClient === 'function') {
            try {
                supabaseInstance = window.supabase.createClient(
                    AppConfig.supabaseUrl,
                    AppConfig.supabaseAnonKey
                );
                return supabaseInstance;
            } catch (error) {
                console.error('[SupabaseManager] Error initializing client:', error);
                return null;
            }
        } else {
            console.warn('[SupabaseManager] Supabase JS SDK not loaded from CDN.');
            return null;
        }
    },

    // Reset instance when config changes
    resetClient() {
        supabaseInstance = null;
    },

    // Test connection with Supabase backend
    async testConnection() {
        if (!AppConfig.isConfigured()) {
            return {
                success: false,
                mode: 'demo',
                message: 'Supabase credentials not configured. Running in Demo / Offline Mode.'
            };
        }

        const client = this.getClient();
        if (!client) {
            return {
                success: false,
                mode: 'demo',
                message: 'Failed to create Supabase client. Check credentials.'
            };
        }

        try {
            // Attempt a lightweight select query on sales_team table
            const { data, error } = await client
                .from('sales_team')
                .select('count', { count: 'exact', head: true });

            if (error) {
                // Check if table missing error
                if (error.code === '42P01') {
                    return {
                        success: false,
                        mode: 'connected_missing_tables',
                        message: 'Connected to Supabase, but tables are missing. Please execute schema.sql in SQL Editor.'
                    };
                }
                return {
                    success: false,
                    mode: 'error',
                    message: `Supabase Error: ${error.message}`
                };
            }

            return {
                success: true,
                mode: 'live',
                message: 'Successfully connected to live Supabase database!'
            };
        } catch (err) {
            return {
                success: false,
                mode: 'error',
                message: `Connection failed: ${err.message}`
            };
        }
    },

    // Upload an image (File or base64) to Supabase Storage bucket 'warehouse-photos'
    // Returns the public URL if uploaded, or returns the base64 string in demo mode
    async uploadImage(fileOrBase64, pathPrefix = 'cartons') {
        const client = this.getClient();

        // If not connected to Supabase or running in demo mode, return the base64 representation directly
        if (!client) {
            if (typeof fileOrBase64 === 'string') {
                return fileOrBase64;
            }
            return await this.fileToBase64(fileOrBase64);
        }

        try {
            let fileToUpload = fileOrBase64;
            let fileExt = 'jpg';

            if (typeof fileOrBase64 === 'string') {
                // Base64 to Blob
                const mimeMatch = fileOrBase64.match(/^data:([^;]+);base64,/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                fileExt = mimeType.split('/')[1] || 'jpg';
                fileToUpload = this.base64ToBlob(fileOrBase64, mimeType);
            } else if (fileOrBase64 instanceof File) {
                fileExt = fileOrBase64.name.split('.').pop() || 'jpg';
            }

            const fileName = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;

            const { data, error } = await client.storage
                .from(AppConfig.storageBucketName)
                .upload(fileName, fileToUpload, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) {
                console.warn('[SupabaseManager] Storage upload error, falling back to base64:', error);
                return typeof fileOrBase64 === 'string' ? fileOrBase64 : await this.fileToBase64(fileOrBase64);
            }

            // Get Public URL
            const { data: urlData } = client.storage
                .from(AppConfig.storageBucketName)
                .getPublicUrl(fileName);

            return urlData.publicUrl;
        } catch (err) {
            console.error('[SupabaseManager] Error during upload:', err);
            return typeof fileOrBase64 === 'string' ? fileOrBase64 : await this.fileToBase64(fileOrBase64);
        }
    },

    // Utility: Convert File to base64 Data URL
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });
    },

    // Utility: Convert Base64 Data URL to Blob
    base64ToBlob(base64Data, contentType = 'image/jpeg') {
        const base64WithoutHeader = base64Data.replace(/^data:[^;]+;base64,/, '');
        const byteCharacters = atob(base64WithoutHeader);
        const byteArrays = [];

        for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        return new Blob(byteArrays, { type: contentType });
    }
};
