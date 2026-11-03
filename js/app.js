// ==============================================================================
// WAREHOUSE ERP - UNIFIED APPLICATION BUNDLE
// Self-contained script compatible with BOTH local file:// and web servers / GitHub Pages
// Supports:
// - Multi-Photo Upload per Unique ID (At least 15 photos via Direct Camera & Bulk Upload)
// - Global Batch Photo Distribution
// - Dynamic Carton Unique IDs ([AWB]C1, [AWB]C2...)
// - Interactive Multi-Photo Lightbox Gallery with Filmstrip & Keyboard Arrows
// - Non-blocking Dispatch Submission (No Mandatory Restriction)
// - Cartons Ledger Table with Excel (.xlsx) Export
// - Sales & Warehouse Team Directory (Add / Delete)
// - Supabase Cloud Database & Storage Sync
// ==============================================================================

(function () {
    'use strict';

    // --------------------------------------------------------------------------
    // 1. CONFIGURATION SERVICE
    // --------------------------------------------------------------------------
    const CONFIG_STORAGE_KEY = 'warehouse_erp_supabase_config';
    const TEAM_STORAGE_KEY = 'warehouse_erp_sales_team_members';
    const DISPATCH_STORAGE_KEY = 'warehouse_erp_dispatches_cache';
    const CARTON_STORAGE_KEY = 'warehouse_erp_cartons_cache';

    const AppConfig = {
        supabaseUrl: localStorage.getItem(`${CONFIG_STORAGE_KEY}_url`) || '',
        supabaseAnonKey: localStorage.getItem(`${CONFIG_STORAGE_KEY}_key`) || '',
        storageBucketName: 'warehouse-photos',

        isConfigured() {
            return Boolean(
                this.supabaseUrl &&
                this.supabaseAnonKey &&
                this.supabaseUrl.trim().startsWith('https://') &&
                this.supabaseAnonKey.trim().length > 20
            );
        },

        saveConfig(url, key) {
            this.supabaseUrl = (url || '').trim().replace(/\/+$/, '');
            this.supabaseAnonKey = (key || '').trim().replace(/^["']|["']$/g, '');
            localStorage.setItem(`${CONFIG_STORAGE_KEY}_url`, this.supabaseUrl);
            localStorage.setItem(`${CONFIG_STORAGE_KEY}_key`, this.supabaseAnonKey);
        },

        clearConfig() {
            this.supabaseUrl = '';
            this.supabaseAnonKey = '';
            localStorage.removeItem(`${CONFIG_STORAGE_KEY}_url`);
            localStorage.removeItem(`${CONFIG_STORAGE_KEY}_key`);
        }
    };

    // --------------------------------------------------------------------------
    // 2. SUPABASE CLIENT & STORAGE MANAGER
    // --------------------------------------------------------------------------
    let supabaseInstance = null;

    const SupabaseManager = {
        getClient() {
            if (!AppConfig.isConfigured()) return null;
            if (supabaseInstance) return supabaseInstance;

            if (window.supabase && typeof window.supabase.createClient === 'function') {
                try {
                    supabaseInstance = window.supabase.createClient(
                        AppConfig.supabaseUrl,
                        AppConfig.supabaseAnonKey
                    );
                    return supabaseInstance;
                } catch (e) {
                    console.error('[SupabaseManager] Init error:', e);
                    return null;
                }
            }
            return null;
        },

        resetClient() {
            supabaseInstance = null;
        },

        async testConnection() {
            if (!AppConfig.isConfigured()) {
                return { success: false, mode: 'demo', message: 'Demo Mode (Offline). Enter both Project URL & Anon Key.' };
            }

            const cleanUrl = AppConfig.supabaseUrl.trim().replace(/\/+$/, '');
            const cleanKey = AppConfig.supabaseAnonKey.trim().replace(/^["']|["']$/g, '');

            // Strict 6-second AbortController timeout so UI never hangs
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            try {
                // Step 1: Fast direct native REST API ping
                const pingUrl = `${cleanUrl}/rest/v1/`;
                const pingRes = await fetch(pingUrl, {
                    method: 'GET',
                    headers: {
                        'apikey': cleanKey,
                        'Authorization': `Bearer ${cleanKey}`
                    },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // Handle HTTP response codes
                if (pingRes.status === 401) {
                    let errDetail = 'Invalid Anon Public Key';
                    try {
                        const json = await pingRes.json();
                        if (json && json.message) errDetail = json.message;
                    } catch (e) {}
                    return {
                        success: false,
                        mode: 'invalid_key',
                        message: `Authentication Failed (${errDetail}). Please ensure you copied the "anon public" key from Project Settings -> API, not the service role key or user password.`
                    };
                }

                if (!pingRes.ok && pingRes.status !== 200 && pingRes.status !== 300) {
                    return {
                        success: false,
                        mode: 'error',
                        message: `Supabase server returned HTTP status ${pingRes.status} (${pingRes.statusText || 'Error'}).`
                    };
                }

                // Step 2: Key & Project are verified! Check if sales_team table exists
                const tableController = new AbortController();
                const tableTimeout = setTimeout(() => tableController.abort(), 5000);

                try {
                    const tableRes = await fetch(`${cleanUrl}/rest/v1/sales_team?select=id&limit=1`, {
                        method: 'GET',
                        headers: {
                            'apikey': cleanKey,
                            'Authorization': `Bearer ${cleanKey}`
                        },
                        signal: tableController.signal
                    });

                    clearTimeout(tableTimeout);

                    if (tableRes.ok) {
                        return {
                            success: true,
                            mode: 'live',
                            message: 'Connected to live Supabase! Database tables verified.'
                        };
                    }

                    let errBody = '';
                    try {
                        errBody = await tableRes.text();
                    } catch (e) {}

                    if (tableRes.status === 404 || errBody.includes('42P01') || errBody.includes('does not exist') || errBody.includes('PGRST205')) {
                        return {
                            success: false,
                            mode: 'missing_tables',
                            message: 'Connected to Supabase project successfully! However, the "sales_team" table was not found. Please run schema.sql in Supabase SQL Editor.'
                        };
                    }

                    return {
                        success: true,
                        mode: 'live',
                        message: 'Connected to Supabase project!'
                    };
                } catch (tableErr) {
                    clearTimeout(tableTimeout);
                    return {
                        success: true,
                        mode: 'live',
                        message: 'Connected to Supabase project!'
                    };
                }

            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    return {
                        success: false,
                        mode: 'timeout',
                        message: 'Connection timed out after 6 seconds. Please check your internet connection or verify your Supabase project is active at supabase.com.'
                    };
                }
                return {
                    success: false,
                    mode: 'network_error',
                    message: `Network error: ${err.message || 'Could not connect to Supabase.'}. Please verify your Project URL.`
                };
            }
        },

        async uploadImage(fileOrBase64, pathPrefix = 'cartons') {
            const client = this.getClient();
            if (!client) return fileOrBase64;

            try {
                let fileToUpload = fileOrBase64;
                let fileExt = 'jpg';

                if (typeof fileOrBase64 === 'string') {
                    if (!fileOrBase64.startsWith('data:image')) return fileOrBase64;
                    const mimeMatch = fileOrBase64.match(/^data:([^;]+);base64,/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                    fileExt = mimeType.split('/')[1] || 'jpg';
                    fileToUpload = this.base64ToBlob(fileOrBase64, mimeType);
                } else if (fileOrBase64 instanceof File) {
                    fileExt = fileOrBase64.name.split('.').pop() || 'jpg';
                }

                const fileName = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
                const { error } = await client.storage
                    .from(AppConfig.storageBucketName)
                    .upload(fileName, fileToUpload, { cacheControl: '3600', upsert: false });

                if (error) {
                    console.warn('[SupabaseManager] Upload fallback:', error);
                    return fileOrBase64;
                }

                const { data: urlData } = client.storage
                    .from(AppConfig.storageBucketName)
                    .getPublicUrl(fileName);

                return urlData.publicUrl;
            } catch (err) {
                console.error('[SupabaseManager] Upload error:', err);
                return fileOrBase64;
            }
        },

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
                byteArrays.push(new Uint8Array(byteNumbers));
            }
            return new Blob(byteArrays, { type: contentType });
        }
    };

    // --------------------------------------------------------------------------
    // 3. TEAM MEMBERS SERVICE (ADD / DELETE SALES TEAM)
    // --------------------------------------------------------------------------
    const DEFAULT_MEMBERS = [
        {
            id: 'mem_1',
            name: 'Rahul Sharma',
            role: 'Sales Manager',
            email: 'rahul.sharma@example.com',
            phone: '+91 98765 43210',
            employee_id: 'EMP-101',
            is_active: true
        },
        {
            id: 'mem_2',
            name: 'Priya Patel',
            role: 'Warehouse Supervisor',
            email: 'priya.patel@example.com',
            phone: '+91 98765 43211',
            employee_id: 'EMP-102',
            is_active: true
        },
        {
            id: 'mem_3',
            name: 'Amit Verma',
            role: 'Sales Representative',
            email: 'amit.verma@example.com',
            phone: '+91 98765 43212',
            employee_id: 'EMP-103',
            is_active: true
        },
        {
            id: 'mem_4',
            name: 'Vikram Singh',
            role: 'Dispatch Officer',
            email: 'vikram.singh@example.com',
            phone: '+91 98765 43213',
            employee_id: 'EMP-104',
            is_active: true
        }
    ];

    const TeamService = {
        async getAllMembers() {
            const cached = localStorage.getItem(TEAM_STORAGE_KEY);
            if (cached !== null) {
                try {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed)) {
                        return parsed;
                    }
                } catch (e) {}
            }

            const client = SupabaseManager.getClient();
            if (client) {
                try {
                    const { data, error } = await Promise.race([
                        client.from('sales_team').select('*').order('created_at', { ascending: true }),
                        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 3000))
                    ]);

                    if (!error && Array.isArray(data) && data.length > 0) {
                        localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(data));
                        return data;
                    }
                } catch (e) {
                    console.warn('[TeamService] Supabase team fetch note:', e);
                }
            }

            localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(DEFAULT_MEMBERS));
            return DEFAULT_MEMBERS;
        },

        async addMember({ name, role, email, phone, employee_id }) {
            if (!name || !name.trim()) throw new Error('Member name is required.');

            const newMember = {
                id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                name: name.trim(),
                role: role ? role.trim() : 'Sales Representative',
                email: email ? email.trim() : '',
                phone: phone ? phone.trim() : '',
                employee_id: employee_id ? employee_id.trim() : `EMP-${Math.floor(100 + Math.random() * 900)}`,
                is_active: true,
                created_at: new Date().toISOString()
            };

            // Local state updated first
            state.teamMembers = state.teamMembers || [];
            state.teamMembers.push(newMember);
            localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(state.teamMembers));

            // Background cloud sync
            this.syncAddToCloud(newMember);

            return newMember;
        },

        async deleteMember(idOrIdx, optionalName) {
            if (idOrIdx === undefined || idOrIdx === null) return false;
            let memberName = optionalName || '';
            let targetId = typeof idOrIdx === 'string' ? idOrIdx : '';

            let foundIdx = -1;
            if (typeof idOrIdx === 'number') {
                foundIdx = idOrIdx;
            } else {
                foundIdx = (state.teamMembers || []).findIndex(m => 
                    String(m.id) === String(idOrIdx) || 
                    (m.name && m.name.toLowerCase() === String(idOrIdx).toLowerCase())
                );
            }

            if (foundIdx >= 0 && foundIdx < (state.teamMembers || []).length) {
                const removed = state.teamMembers.splice(foundIdx, 1)[0];
                if (removed) {
                    memberName = removed.name || memberName;
                    targetId = removed.id || targetId;
                }
            } else {
                state.teamMembers = (state.teamMembers || []).filter(m => {
                    if (String(m.id) === String(idOrIdx) || (m.name && m.name === String(idOrIdx))) {
                        memberName = m.name;
                        targetId = m.id;
                        return false;
                    }
                    return true;
                });
            }

            localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(state.teamMembers));

            if (targetId || memberName) {
                this.syncDeleteToCloud(targetId, memberName);
            }
            return true;
        },

        async syncAddToCloud(member) {
            const client = SupabaseManager.getClient();
            if (!client) return;
            try {
                const { data, error } = await Promise.race([
                    client.from('sales_team').insert([{
                        name: member.name,
                        role: member.role,
                        email: member.email,
                        phone: member.phone,
                        employee_id: member.employee_id,
                        is_active: true
                    }]).select().single(),
                    new Promise((_, r) => setTimeout(() => r(new Error('Cloud sync timeout')), 4000))
                ]);
                if (!error && data && data.id) {
                    member.id = data.id;
                    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(state.teamMembers));
                }
            } catch (e) {
                console.warn('[TeamService] Cloud add sync note:', e);
            }
        },

        async syncDeleteToCloud(id, name) {
            const client = SupabaseManager.getClient();
            if (!client) return;
            try {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
                if (isUuid) {
                    await Promise.race([
                        client.from('sales_team').delete().eq('id', id),
                        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 3000))
                    ]);
                } else if (name) {
                    await Promise.race([
                        client.from('sales_team').delete().eq('name', name),
                        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 3000))
                    ]);
                }
            } catch (e) {
                console.warn('[TeamService] Cloud delete sync note:', e);
            }
        }
    };

    // --------------------------------------------------------------------------
    // 3.5. PARTY NAMES SERVICE (AUTOCOMPLETE, DROPDOWN & PERSISTENCE)
    // --------------------------------------------------------------------------
    const PARTY_STORAGE_KEY = 'warehouse_party_names';
    const DEFAULT_PARTIES = [
        'Apex Electricals Pvt Ltd',
        'Metro Fan & Appliances',
        'Royal Electronics Delhi',
        'Shree Ganesh Traders'
    ];

    const PartyService = {
        getAllParties() {
            let saved = [];
            try {
                const raw = localStorage.getItem(PARTY_STORAGE_KEY);
                if (raw) saved = JSON.parse(raw);
            } catch (e) {}

            const fromCartons = (state.allCartons || [])
                .map(c => (c.customer_name || '').trim())
                .filter(Boolean);

            const all = Array.from(new Set([...DEFAULT_PARTIES, ...saved, ...fromCartons]))
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));

            return all;
        },

        saveParty(partyName) {
            if (!partyName || !partyName.trim()) return;
            const clean = partyName.trim();
            const current = this.getAllParties();
            if (!current.includes(clean)) {
                current.push(clean);
                current.sort((a, b) => a.localeCompare(b));
            }
            try {
                localStorage.setItem(PARTY_STORAGE_KEY, JSON.stringify(current));
            } catch (e) {}
            this.renderPartyControls();
        },

        removeParty(partyName, event) {
            if (event) event.stopPropagation();
            const clean = (partyName || '').trim();
            let saved = [];
            try {
                const raw = localStorage.getItem(PARTY_STORAGE_KEY);
                if (raw) saved = JSON.parse(raw);
            } catch (e) {}
            saved = saved.filter(p => p.toLowerCase() !== clean.toLowerCase());
            try {
                localStorage.setItem(PARTY_STORAGE_KEY, JSON.stringify(saved));
            } catch (e) {}
            this.renderPartyControls();
        },

        renderPartyControls() {
            const parties = this.getAllParties();
            const inputVal = (document.getElementById('inputPartyName')?.value || '').toLowerCase().trim();

            // 1. Datalist for native autocomplete
            const datalist = document.getElementById('partyNameDatalist');
            if (datalist) {
                datalist.innerHTML = parties.map(p => `<option value="${escapeHtml(p)}">`).join('');
            }

            // 2. Count text in button
            const countText = document.getElementById('partyCountText');
            if (countText) countText.textContent = parties.length;

            // 3. Dropdown list items
            const dropdownList = document.getElementById('partyDropdownList');
            if (dropdownList) {
                const filteredParties = inputVal
                    ? parties.filter(p => p.toLowerCase().includes(inputVal))
                    : parties;

                if (filteredParties.length === 0) {
                    dropdownList.innerHTML = `
                        <div class="px-3 py-3 text-center text-xs text-slate-400">
                            No matching saved party. Type to add a new one.
                        </div>
                    `;
                } else {
                    dropdownList.innerHTML = filteredParties.map(party => {
                        const cartonCount = (state.allCartons || []).filter(c => (c.customer_name || '').toLowerCase() === party.toLowerCase()).length;
                        const safeParty = escapeHtml(party).replace(/'/g, "\\'");
                        return `
                            <div onclick="window.selectPartyName('${safeParty}')" class="px-3 py-2 hover:bg-emerald-50 cursor-pointer flex items-center justify-between group transition-colors">
                                <div class="flex items-center gap-2">
                                    <div class="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                                        <i data-lucide="building" class="w-3.5 h-3.5"></i>
                                    </div>
                                    <span class="text-xs font-semibold text-slate-800 group-hover:text-emerald-900">${escapeHtml(party)}</span>
                                </div>
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[10px] text-slate-400 bg-slate-100 group-hover:bg-emerald-100 group-hover:text-emerald-800 px-2 py-0.5 rounded-full font-medium">
                                        ${cartonCount > 0 ? `${cartonCount} cartons` : 'Saved'}
                                    </span>
                                    <button type="button" onclick="window.deletePartyName('${safeParty}', event)" class="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-rose-600 rounded transition-all" title="Remove from list">
                                        <i data-lucide="x" class="w-3 h-3"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // 4. Quick pick chips under input
            const chipsContainer = document.getElementById('partyQuickChips');
            if (chipsContainer) {
                const topParties = parties.slice(0, 5);
                chipsContainer.innerHTML = `
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Quick Pick:</span>
                    ${topParties.map(p => {
                        const safeP = escapeHtml(p).replace(/'/g, "\\'");
                        return `
                            <button type="button" onclick="window.selectPartyName('${safeP}')" class="px-2.5 py-1 bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-800 font-medium rounded-lg text-xs whitespace-nowrap transition-colors border border-slate-200 hover:border-emerald-300">
                                ${escapeHtml(p)}
                            </button>
                        `;
                    }).join('')}
                `;
            }

            // 5. Ledger Filter Dropdown
            const filterSelect = document.getElementById('filterPartySelect');
            if (filterSelect) {
                const currentVal = filterSelect.value;
                filterSelect.innerHTML = `
                    <option value="">All Parties (${parties.length})</option>
                    ${parties.map(p => `<option value="${escapeHtml(p)}" ${p === currentVal ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
                `;
            }

            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        }
    };

    // --------------------------------------------------------------------------
    // 4. SAMPLE GALLERIES & DISPATCH SERVICE
    // --------------------------------------------------------------------------
    const SAMPLE_FAN_IMGS = [
        'https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=600&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1618220179428-22790b461013?w=600&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=600&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=600&auto=format&fit=crop&q=80'
    ];

    const SEED_CARTONS = [
        {
            id: 'cart-1',
            dispatch_id: 'disp-001',
            carton_index: 1,
            carton_unique_id: '78291045C1',
            awb_number: '78291045',
            customer_name: 'Apex Electricals Pvt Ltd',
            uploaded_by: 'Rahul Sharma',
            dispatch_date: '2026-11-01',
            total_cartons: 4,
            fan_name: 'AeroStorm 1200mm Matte White',
            image_url: SAMPLE_FAN_IMGS[0],
            photos: [SAMPLE_FAN_IMGS[0], SAMPLE_FAN_IMGS[1], SAMPLE_FAN_IMGS[2]],
            status: 'Dispatched',
            created_at: new Date(Date.now() - 86400000).toISOString()
        },
        {
            id: 'cart-2',
            dispatch_id: 'disp-001',
            carton_index: 2,
            carton_unique_id: '78291045C2',
            awb_number: '78291045',
            customer_name: 'Apex Electricals Pvt Ltd',
            uploaded_by: 'Rahul Sharma',
            dispatch_date: '2026-11-01',
            total_cartons: 4,
            fan_name: 'BreezeMax High Speed Brown',
            image_url: SAMPLE_FAN_IMGS[1],
            photos: [SAMPLE_FAN_IMGS[1], SAMPLE_FAN_IMGS[3]],
            status: 'Dispatched',
            created_at: new Date(Date.now() - 86400000).toISOString()
        },
        {
            id: 'cart-3',
            dispatch_id: 'disp-001',
            carton_index: 3,
            carton_unique_id: '78291045C3',
            awb_number: '78291045',
            customer_name: 'Apex Electricals Pvt Ltd',
            uploaded_by: 'Rahul Sharma',
            dispatch_date: '2026-11-01',
            total_cartons: 4,
            fan_name: 'SilentPro BLDC 5-Star Ivory',
            image_url: SAMPLE_FAN_IMGS[2],
            photos: [SAMPLE_FAN_IMGS[2], SAMPLE_FAN_IMGS[0], SAMPLE_FAN_IMGS[3]],
            status: 'Dispatched',
            created_at: new Date(Date.now() - 86400000).toISOString()
        },
        {
            id: 'cart-4',
            dispatch_id: 'disp-001',
            carton_index: 4,
            carton_unique_id: '78291045C4',
            awb_number: '78291045',
            customer_name: 'Apex Electricals Pvt Ltd',
            uploaded_by: 'Rahul Sharma',
            dispatch_date: '2026-11-01',
            total_cartons: 4,
            fan_name: 'TurboAir Exhaust Fan 200mm Metallic',
            image_url: SAMPLE_FAN_IMGS[3],
            photos: [SAMPLE_FAN_IMGS[3], SAMPLE_FAN_IMGS[1]],
            status: 'Dispatched',
            created_at: new Date(Date.now() - 86400000).toISOString()
        },
        {
            id: 'cart-5',
            dispatch_id: 'disp-002',
            carton_index: 1,
            carton_unique_id: '99401823C1',
            awb_number: '99401823',
            customer_name: 'Metro Fan & Appliances',
            uploaded_by: 'Priya Patel',
            dispatch_date: '2026-11-02',
            total_cartons: 3,
            fan_name: 'EcoVent Pedestal 400mm Black',
            image_url: SAMPLE_FAN_IMGS[1],
            photos: [SAMPLE_FAN_IMGS[1], SAMPLE_FAN_IMGS[0]],
            status: 'Ready for Dispatch',
            created_at: new Date().toISOString()
        },
        {
            id: 'cart-6',
            dispatch_id: 'disp-002',
            carton_index: 2,
            carton_unique_id: '99401823C2',
            awb_number: '99401823',
            customer_name: 'Metro Fan & Appliances',
            uploaded_by: 'Priya Patel',
            dispatch_date: '2026-11-02',
            total_cartons: 3,
            fan_name: 'AeroStorm 1200mm Pearl Gold',
            image_url: SAMPLE_FAN_IMGS[0],
            photos: [SAMPLE_FAN_IMGS[0], SAMPLE_FAN_IMGS[2], SAMPLE_FAN_IMGS[3]],
            status: 'Ready for Dispatch',
            created_at: new Date().toISOString()
        },
        {
            id: 'cart-7',
            dispatch_id: 'disp-002',
            carton_index: 3,
            carton_unique_id: '99401823C3',
            awb_number: '99401823',
            customer_name: 'Metro Fan & Appliances',
            uploaded_by: 'Priya Patel',
            dispatch_date: '2026-11-02',
            total_cartons: 3,
            fan_name: 'AeroStorm 1200mm Pearl Gold',
            image_url: SAMPLE_FAN_IMGS[2],
            photos: [SAMPLE_FAN_IMGS[2]],
            status: 'Ready for Dispatch',
            created_at: new Date().toISOString()
        }
    ];

    const DispatchService = {
        async getAllCartons() {
            const client = SupabaseManager.getClient();
            if (client) {
                try {
                    const { data, error } = await client
                        .from('warehouse_cartons')
                        .select(`
                            id,
                            dispatch_id,
                            carton_index,
                            carton_unique_id,
                            awb_number,
                            customer_name,
                            fan_name,
                            image_url,
                            additional_images,
                            created_at,
                            warehouse_dispatches (
                                dispatch_date,
                                total_cartons,
                                uploaded_by,
                                shipment_unique_id
                            )
                        `)
                        .order('created_at', { ascending: false });

                    if (!error && Array.isArray(data) && data.length > 0) {
                        const formatted = data.map(item => {
                            const d = item.warehouse_dispatches || {};
                            let photosList = [];
                            if (Array.isArray(item.additional_images) && item.additional_images.length > 0) {
                                photosList = item.additional_images;
                            } else if (item.image_url) {
                                photosList = [item.image_url];
                            }

                            return {
                                id: item.id,
                                dispatch_id: item.dispatch_id,
                                carton_index: item.carton_index,
                                carton_unique_id: item.carton_unique_id,
                                awb_number: item.awb_number,
                                customer_name: item.customer_name,
                                fan_name: item.fan_name,
                                image_url: item.image_url,
                                photos: photosList,
                                dispatch_date: d.dispatch_date || new Date(item.created_at).toISOString().split('T')[0],
                                total_cartons: d.total_cartons || 1,
                                uploaded_by: d.uploaded_by || 'Warehouse Staff',
                                shipment_unique_id: d.shipment_unique_id || '',
                                status: 'Ready for Dispatch',
                                created_at: item.created_at
                            };
                        });
                        localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(formatted));
                        return formatted;
                    }
                } catch (e) {
                    console.warn('[DispatchService] Supabase fetch fallback:', e);
                }
            }

            const cached = localStorage.getItem(CARTON_STORAGE_KEY);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    // Ensure photos array exists on each carton
                    parsed.forEach(c => {
                        if (!c.photos) c.photos = c.image_url ? [c.image_url] : [];
                    });
                    return parsed;
                } catch (e) {}
            }

            localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(SEED_CARTONS));
            return SEED_CARTONS;
        },

        async createDispatch({
            dispatch_date,
            awb_number,
            customer_name,
            uploaded_by,
            cartons = []
        }) {
            const cleanAWB = (awb_number || 'AWB').trim().toUpperCase();
            const cleanCustomer = (customer_name || 'Customer').trim();
            const cleanUploader = (uploaded_by || 'Staff').trim();
            const totalCartons = cartons.length || 1;
            const dateStr = dispatch_date || new Date().toISOString().split('T')[0];

            const safeCust = cleanCustomer.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase() || 'CUST';
            const safeUploader = cleanUploader.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase() || 'USER';
            const safeDate = dateStr.replace(/-/g, '');
            const shipmentUniqueId = `WH-${safeDate}-${safeCust}-${safeUploader}-${cleanAWB}`;
            const dispatchId = 'disp-' + Date.now();

            const newCartonRecords = [];

            for (let i = 0; i < cartons.length; i++) {
                const c = cartons[i];
                const cartonIndex = i + 1;
                const cartonUniqueId = `${cleanAWB}C${cartonIndex}`;
                const fanName = (c.fan_name && c.fan_name.trim()) ? c.fan_name.trim() : `Fan Model C${cartonIndex}`;

                // Process photos list (each photo can be uploaded to Supabase or kept as base64)
                const processedPhotos = [];
                const rawPhotos = c.photos || (c.image_url ? [c.image_url] : []);

                for (let pIdx = 0; pIdx < rawPhotos.length; pIdx++) {
                    let photoUrl = rawPhotos[pIdx];
                    if (photoUrl && photoUrl.startsWith('data:image')) {
                        photoUrl = await SupabaseManager.uploadImage(photoUrl, `carton_${cartonUniqueId}_${pIdx + 1}`);
                    }
                    processedPhotos.push(photoUrl);
                }

                const primaryImage = processedPhotos[0] || null;

                newCartonRecords.push({
                    id: 'cart_' + Date.now() + '_' + i,
                    dispatch_id: dispatchId,
                    carton_index: cartonIndex,
                    carton_unique_id: cartonUniqueId,
                    awb_number: cleanAWB,
                    customer_name: cleanCustomer,
                    uploaded_by: cleanUploader,
                    dispatch_date: dateStr,
                    total_cartons: totalCartons,
                    fan_name: fanName,
                    image_url: primaryImage,
                    photos: processedPhotos,
                    shipment_unique_id: shipmentUniqueId,
                    status: 'Ready for Dispatch',
                    created_at: new Date().toISOString()
                });
            }

            // Supabase save attempt
            const client = SupabaseManager.getClient();
            if (client) {
                try {
                    const { data: dispData } = await client
                        .from('warehouse_dispatches')
                        .insert([{
                            dispatch_date: dateStr,
                            awb_number: cleanAWB,
                            total_cartons: totalCartons,
                            customer_name: cleanCustomer,
                            uploaded_by: cleanUploader,
                            shipment_unique_id: shipmentUniqueId
                        }])
                        .select()
                        .single();

                    if (dispData) {
                        const sId = dispData.id;
                        const toInsert = newCartonRecords.map(c => ({
                            dispatch_id: sId,
                            carton_index: c.carton_index,
                            carton_unique_id: c.carton_unique_id,
                            awb_number: c.awb_number,
                            customer_name: c.customer_name,
                            fan_name: c.fan_name,
                            image_url: c.image_url || '',
                            additional_images: c.photos || []
                        }));
                        await client.from('warehouse_cartons').insert(toInsert);
                    }
                } catch (e) {
                    console.warn('[DispatchService] Supabase insert fallback:', e);
                }
            }

            // Local cache update
            const all = await this.getAllCartons();
            const updated = [...newCartonRecords, ...all];
            localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(updated));

            return newCartonRecords;
        },

        async deleteCarton(cartonId) {
            if (!cartonId) return;
            const client = SupabaseManager.getClient();
            if (client) {
                try {
                    await client.from('warehouse_cartons').delete().eq('id', cartonId);
                } catch (e) {}
            }
            let all = await this.getAllCartons();
            all = all.filter(c => c.id !== cartonId);
            localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(all));
        },

        async toggleDispatchStatus(cartonId) {
            let all = await this.getAllCartons();
            const c = all.find(item => item.id === cartonId);
            if (!c) return 'Ready for Dispatch';
            c.status = c.status === 'Dispatched' ? 'Ready for Dispatch' : 'Dispatched';
            localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(all));
            return c.status;
        },

        exportToExcel(cartonList = []) {
            if (!window.XLSX) {
                alert('SheetJS Excel library not available.');
                return;
            }
            if (!cartonList || cartonList.length === 0) {
                alert('No records available to export.');
                return;
            }

            const dataRows = cartonList.map((item, idx) => {
                const photoCount = item.photos ? item.photos.length : (item.image_url ? 1 : 0);
                return {
                    'S.No': idx + 1,
                    'Date': item.dispatch_date,
                    'Total Cartons': item.total_cartons,
                    'Unique ID (AWB+Carton)': item.carton_unique_id,
                    'Name of Party': item.customer_name,
                    'Fan Name': item.fan_name,
                    'Total Photos': `${photoCount} Photo(s)`,
                    'Primary Image URL': item.image_url && !item.image_url.startsWith('data:') ? item.image_url : (item.image_url ? 'Embedded In-App' : 'None'),
                    'Uploaded By': item.uploaded_by || 'Staff',
                    'AWB Number': item.awb_number,
                    'Shipment Batch ID': item.shipment_unique_id || '',
                    'Status': item.status || 'Ready for Dispatch',
                    'Timestamp': item.created_at
                };
            });

            const worksheet = window.XLSX.utils.json_to_sheet(dataRows);
            const workbook = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Warehouse Cartons');
            window.XLSX.writeFile(workbook, `Warehouse_Cartons_Ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
        }
    };

    // --------------------------------------------------------------------------
    // 5. APPLICATION STATE & TAB NAVIGATION
    // --------------------------------------------------------------------------
    const state = {
        activeTab: 'new-dispatch',
        teamMembers: [],
        allCartons: [],
        currentCartonRows: []
    };

    // Global Tab Switcher
    window.switchTab = function (tabName) {
        state.activeTab = tabName;

        document.querySelectorAll('.tab-pane').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none';
        });

        const targetPane = document.getElementById(
            tabName === 'new-dispatch' ? 'paneNewDispatch' :
            tabName === 'ledger' ? 'paneLedger' : 'paneSettings'
        );

        if (targetPane) {
            targetPane.classList.add('active');
            targetPane.style.display = 'block';
        }

        const btnNew = document.getElementById('tabBtnNewDispatch');
        const btnLedger = document.getElementById('tabBtnLedger');
        const btnSettings = document.getElementById('tabBtnSettings');

        const deskDefault = 'tab-btn px-4 py-2 rounded-lg text-sm font-medium transition-all text-slate-600 hover:text-slate-900 flex items-center gap-2';
        const deskActive = 'tab-btn px-4 py-2 rounded-lg text-sm font-semibold transition-all bg-white text-emerald-700 shadow-sm flex items-center gap-2';

        if (btnNew) btnNew.className = tabName === 'new-dispatch' ? deskActive : deskDefault;
        if (btnLedger) btnLedger.className = tabName === 'ledger' ? deskActive : deskDefault;
        if (btnSettings) btnSettings.className = tabName === 'settings' ? deskActive : deskDefault;

        const mobNew = document.getElementById('mobTabNew');
        const mobLedger = document.getElementById('mobTabLedger');
        const mobSettings = document.getElementById('mobTabSettings');

        const mobDefault = 'flex-1 py-2 text-xs font-medium text-center rounded-lg text-slate-600 flex items-center justify-center gap-1';
        const mobActive = 'flex-1 py-2 text-xs font-semibold text-center rounded-lg bg-white text-emerald-700 shadow-xs flex items-center justify-center gap-1';

        if (mobNew) mobNew.className = tabName === 'new-dispatch' ? mobActive : mobDefault;
        if (mobLedger) mobLedger.className = tabName === 'ledger' ? mobActive : mobDefault;
        if (mobSettings) mobSettings.className = tabName === 'settings' ? mobActive : mobDefault;

        if (tabName === 'ledger') {
            window.renderLedgerTable();
        } else if (tabName === 'settings') {
            window.renderTeamDirectory();
        }

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    };

    // --------------------------------------------------------------------------
    // 6. MULTI-PHOTO DYNAMIC CARTON ROW BUILDER (15+ PHOTOS PER UNIQUE ID)
    // --------------------------------------------------------------------------
    window.generateCartonRows = function () {
        const container = document.getElementById('cartonsContainer');
        if (!container) return;

        const totalCartonsInput = document.getElementById('inputTotalCartons');
        let total = parseInt(totalCartonsInput?.value || '4', 10);
        if (isNaN(total) || total < 1) total = 1;
        if (total > 50) total = 50;

        const awb = (document.getElementById('inputAwbNumber')?.value || 'AWB').trim().toUpperCase();
        const existing = state.currentCartonRows || [];
        const newRows = [];

        for (let i = 1; i <= total; i++) {
            const prev = existing[i - 1] || {};
            newRows.push({
                carton_index: i,
                carton_unique_id: `${awb}C${i}`,
                fan_name: prev.fan_name || '',
                photos: prev.photos || (prev.image_url ? [prev.image_url] : [])
            });
        }

        state.currentCartonRows = newRows;
        renderCartonRowsHtml();
    };

    function renderCartonRowsHtml() {
        const container = document.getElementById('cartonsContainer');
        if (!container) return;

        container.innerHTML = state.currentCartonRows.map(row => {
            const index = row.carton_index;
            const photoCount = row.photos.length;
            const hasPhotos = photoCount > 0;

            return `
                <div class="carton-row-item p-4 rounded-2xl border ${hasPhotos ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-white'} transition-all shadow-xs space-y-3">
                    
                    <!-- Row Top Bar: Carton Index, Unique ID, and Fan Name -->
                    <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                        <div class="flex items-center space-x-3">
                            <div class="w-8 h-8 rounded-lg ${hasPhotos ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'} flex items-center justify-center font-bold text-xs">
                                C${index}
                            </div>
                            <div>
                                <span class="text-xs text-slate-500 font-medium">Carton ${index} of ${state.currentCartonRows.length}</span>
                                <div class="flex items-center gap-1.5 mt-0.5">
                                    <span class="text-[10px] uppercase font-bold text-slate-400">Unique ID:</span>
                                    <span id="cartonTag_${index}" class="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-900 font-mono font-bold text-xs tracking-wider border border-emerald-300/50">
                                        ${row.carton_unique_id}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Fan Name Input -->
                        <div class="flex-1 md:max-w-md">
                            <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                                Fan Name / Model (Carton ${index})
                            </label>
                            <input type="text" 
                                   id="inputFanName_${index}" 
                                   value="${escapeHtml(row.fan_name)}" 
                                   oninput="window.updateRowFanName(${index}, this.value)"
                                   placeholder="e.g. AeroStorm 1200mm Matte White" 
                                   class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none">
                        </div>
                    </div>

                    <!-- Photos Section for this Unique ID -->
                    <div class="space-y-2.5">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold text-slate-800">Photos for ${row.carton_unique_id}:</span>
                                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${hasPhotos ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-600'}">
                                    📸 ${photoCount} / 15+ Photos Attached
                                </span>
                            </div>

                            <!-- Upload Actions: Direct Camera Snap & Bulk File Upload -->
                            <div class="flex flex-wrap items-center gap-2">
                                <!-- 1. Direct Camera Snap Button -->
                                <label class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-xs transition-all" title="Snap a photo directly with camera">
                                    <i data-lucide="camera" class="w-3.5 h-3.5"></i>
                                    <span>Snap Photo (Camera)</span>
                                    <input type="file" accept="image/*" capture="environment" class="hidden" onchange="window.handleCartonCameraCapture(${index}, event)">
                                </label>

                                <!-- 2. Bulk Upload Button (Select 15+ files at once) -->
                                <label class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-all" title="Upload multiple photos in bulk from gallery or files">
                                    <i data-lucide="upload-cloud" class="w-3.5 h-3.5"></i>
                                    <span>Bulk Upload Photos</span>
                                    <input type="file" multiple accept="image/*" class="hidden" onchange="window.handleCartonBulkUpload(${index}, event)">
                                </label>

                                ${hasPhotos ? `
                                    <button type="button" onclick="window.clearCartonPhotos(${index})" class="px-2.5 py-1 text-slate-400 hover:text-rose-600 text-xs font-semibold rounded-lg hover:bg-rose-50 transition-colors" title="Remove all photos for this carton">
                                        Clear All
                                    </button>
                                ` : ''}
                            </div>
                        </div>

                        <!-- Thumbnails Filmstrip Grid -->
                        ${hasPhotos ? `
                            <div class="flex flex-wrap gap-2.5 pt-1">
                                ${row.photos.map((photoUrl, pIdx) => `
                                    <div class="relative group w-16 h-16 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden shadow-2xs">
                                        <img src="${photoUrl}" alt="Carton ${index} Photo ${pIdx + 1}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform" onclick="window.previewCartonPhotoGallery(${index}, ${pIdx})">
                                        
                                        <!-- Delete single photo button -->
                                        <button type="button" onclick="window.removeSingleCartonPhoto(${index}, ${pIdx})" class="absolute top-1 right-1 w-4 h-4 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white flex items-center justify-center text-[10px] leading-none transition-colors" title="Delete this photo">
                                            &times;
                                        </button>
                                        
                                        <!-- Photo Index Tag -->
                                        <span class="absolute bottom-1 left-1 text-[9px] bg-slate-900/80 text-white px-1 rounded font-mono font-bold leading-tight">
                                            #${pIdx + 1}
                                        </span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : `
                            <div class="p-3 border border-dashed border-slate-200 rounded-xl bg-slate-50/70 text-center">
                                <p class="text-xs text-slate-400">
                                    Tap <strong>Snap Photo (Camera)</strong> to take photos directly, or <strong>Bulk Upload Photos</strong> to add up to 15+ photos at once.
                                </p>
                            </div>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    window.updateRowFanName = function (cartonIndex, value) {
        const row = state.currentCartonRows.find(r => r.carton_index === cartonIndex);
        if (row) row.fan_name = value;
    };

    window.copyFanNameToAll = function () {
        if (state.currentCartonRows.length === 0) return;
        const first = state.currentCartonRows[0].fan_name;
        if (!first || !first.trim()) {
            showToast('Enter a Fan Name in Carton 1 first.', 'error');
            return;
        }
        state.currentCartonRows.forEach(r => { r.fan_name = first; });
        renderCartonRowsHtml();
        showToast(`Copied "${first}" to all cartons!`, 'success');
    };

    // --------------------------------------------------------------------------
    // 7. PHOTO UPLOAD HANDLERS (CAMERA & BULK PER CARTON)
    // --------------------------------------------------------------------------

    // Direct Camera Capture for a specific carton
    window.handleCartonCameraCapture = function (cartonIndex, event) {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            const row = state.currentCartonRows.find(r => r.carton_index === cartonIndex);
            if (row) {
                if (!row.photos) row.photos = [];
                row.photos.push(e.target.result);
                renderCartonRowsHtml();
                showToast(`Captured photo #${row.photos.length} for ${row.carton_unique_id}!`, 'success');
            }
        };
        reader.readAsDataURL(file);

        // Reset file input so tapping Camera again immediately takes the next photo
        event.target.value = '';
    };

    // Bulk Photo Upload for a specific carton (Select 15+ photos at once)
    window.handleCartonBulkUpload = function (cartonIndex, event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const row = state.currentCartonRows.find(r => r.carton_index === cartonIndex);
        if (!row) return;
        if (!row.photos) row.photos = [];

        let readCount = 0;
        const totalToRead = files.length;

        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = function (e) {
                row.photos.push(e.target.result);
                readCount++;
                if (readCount === totalToRead) {
                    renderCartonRowsHtml();
                    showToast(`Added ${totalToRead} photos to ${row.carton_unique_id}! Total: ${row.photos.length}`, 'success');
                }
            };
            reader.readAsDataURL(file);
        });

        event.target.value = '';
    };

    // Remove single photo from a carton
    window.removeSingleCartonPhoto = function (cartonIndex, photoIndex) {
        const row = state.currentCartonRows.find(r => r.carton_index === cartonIndex);
        if (row && row.photos && row.photos.length > photoIndex) {
            row.photos.splice(photoIndex, 1);
            renderCartonRowsHtml();
        }
    };

    // Clear all photos for a carton
    window.clearCartonPhotos = function (cartonIndex) {
        const row = state.currentCartonRows.find(r => r.carton_index === cartonIndex);
        if (row) {
            row.photos = [];
            renderCartonRowsHtml();
        }
    };

    // Global Batch Upload (distribute across cartons)
    window.handleBatchImageUpload = function (event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const totalCartons = state.currentCartonRows.length;
        if (totalCartons === 0) return;

        // Read all photos first
        const loadedPhotos = [];
        let loaded = 0;

        Array.from(files).forEach((file, fIdx) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                loadedPhotos.push(e.target.result);
                loaded++;
                if (loaded === files.length) {
                    // Distribute across cartons
                    if (totalCartons === 1) {
                        state.currentCartonRows[0].photos.push(...loadedPhotos);
                    } else {
                        loadedPhotos.forEach((photo, idx) => {
                            const cartonTarget = state.currentCartonRows[idx % totalCartons];
                            if (cartonTarget) {
                                if (!cartonTarget.photos) cartonTarget.photos = [];
                                cartonTarget.photos.push(photo);
                            }
                        });
                    }
                    renderCartonRowsHtml();
                    showToast(`Distributed ${loadedPhotos.length} photos across cartons!`, 'success');
                }
            };
            reader.readAsDataURL(file);
        });

        event.target.value = '';
    };

    // --------------------------------------------------------------------------
    // 8. DISPATCH SUBMISSION (NON-BLOCKING)
    // --------------------------------------------------------------------------
    window.handleDispatchSubmit = async function () {
        const date = document.getElementById('inputDispatchDate')?.value || new Date().toISOString().split('T')[0];
        const awb = document.getElementById('inputAwbNumber')?.value.trim();
        const party = document.getElementById('inputPartyName')?.value.trim();
        const uploader = document.getElementById('selectUploadedBy')?.value.trim();

        if (!awb) {
            showToast('Please enter an AWB / Docket number.', 'error');
            document.getElementById('inputAwbNumber')?.focus();
            return;
        }
        if (!party) {
            showToast('Please enter the Name of Party (Customer).', 'error');
            document.getElementById('inputPartyName')?.focus();
            return;
        }

        const submitBtn = document.getElementById('submitDispatchBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Saving Dispatches...';
        }

        try {
            await DispatchService.createDispatch({
                dispatch_date: date,
                awb_number: awb,
                customer_name: party,
                uploaded_by: uploader || 'Warehouse Staff',
                cartons: state.currentCartonRows
            });

            showToast(`Successfully saved ${state.currentCartonRows.length} cartons for AWB ${awb}!`, 'success');
            PartyService.saveParty(party);
            window.resetDispatchForm();

            state.allCartons = await DispatchService.getAllCartons();
            PartyService.renderPartyControls();
            window.switchTab('ledger');
        } catch (err) {
            console.error('Submit error:', err);
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i> Save & Record Dispatches';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
        }
    };

    window.resetDispatchForm = function () {
        const dateInput = document.getElementById('inputDispatchDate');
        if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

        const awb = document.getElementById('inputAwbNumber');
        const party = document.getElementById('inputPartyName');
        const total = document.getElementById('inputTotalCartons');

        if (awb) awb.value = '';
        if (party) party.value = '';
        if (total) total.value = '4';

        window.generateCartonRows();
        updateBatchIdPreview();
        window.closePartyDropdown();
    };

    // --------------------------------------------------------------------------
    // 8.5. PARTY NAMES DROPDOWN CONTROLS
    // --------------------------------------------------------------------------
    window.openPartyDropdown = function () {
        PartyService.renderPartyControls();
        const menu = document.getElementById('partyDropdownMenu');
        if (menu) menu.classList.remove('hidden');
    };

    window.closePartyDropdown = function () {
        const menu = document.getElementById('partyDropdownMenu');
        if (menu) menu.classList.add('hidden');
    };

    window.togglePartyDropdown = function (event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('partyDropdownMenu');
        if (!menu) return;
        if (menu.classList.contains('hidden')) {
            window.openPartyDropdown();
        } else {
            window.closePartyDropdown();
        }
    };

    window.handlePartyInput = function (event) {
        updateBatchIdPreview();
        PartyService.renderPartyControls();
        const menu = document.getElementById('partyDropdownMenu');
        if (menu && menu.classList.contains('hidden')) {
            menu.classList.remove('hidden');
        }
    };

    window.selectPartyName = function (partyName) {
        const input = document.getElementById('inputPartyName');
        if (input) {
            input.value = partyName;
            input.focus();
        }
        window.closePartyDropdown();
        updateBatchIdPreview();
        PartyService.saveParty(partyName);
    };

    window.deletePartyName = function (partyName, event) {
        PartyService.removeParty(partyName, event);
    };

    // --------------------------------------------------------------------------
    // 9. CARTONS LEDGER TABLE
    // --------------------------------------------------------------------------
    window.renderLedgerTable = function () {
        const tbody = document.getElementById('ledgerTableBody');
        const emptyState = document.getElementById('ledgerEmptyState');
        const summaryStats = document.getElementById('ledgerSummaryStats');
        if (!tbody) return;

        const searchTerm = (document.getElementById('ledgerSearchInput')?.value || '').toLowerCase().trim();
        const filterDate = document.getElementById('filterDateInput')?.value || '';
        const filterParty = document.getElementById('filterPartySelect')?.value || '';
        const filterUploader = document.getElementById('filterUploaderSelect')?.value || '';

        const filtered = state.allCartons.filter(item => {
            if (searchTerm) {
                const match = 
                    (item.carton_unique_id || '').toLowerCase().includes(searchTerm) ||
                    (item.awb_number || '').toLowerCase().includes(searchTerm) ||
                    (item.customer_name || '').toLowerCase().includes(searchTerm) ||
                    (item.fan_name || '').toLowerCase().includes(searchTerm) ||
                    (item.uploaded_by || '').toLowerCase().includes(searchTerm);
                if (!match) return false;
            }
            if (filterDate && item.dispatch_date !== filterDate) return false;
            if (filterParty && item.customer_name !== filterParty) return false;
            if (filterUploader && item.uploaded_by !== filterUploader) return false;
            return true;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            if (summaryStats) summaryStats.textContent = 'Showing 0 cartons';
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        const uniqueAWBs = new Set(filtered.map(c => c.awb_number)).size;
        if (summaryStats) {
            summaryStats.textContent = `Showing ${filtered.length} cartons across ${uniqueAWBs} AWB shipment(s)`;
        }

        tbody.innerHTML = filtered.map((c, idx) => {
            const isDispatched = c.status === 'Dispatched';
            const photosList = c.photos && c.photos.length > 0 ? c.photos : (c.image_url ? [c.image_url] : []);
            const photoCount = photosList.length;
            const primaryThumb = photosList[0] || null;

            return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <!-- # Index -->
                    <td class="py-3.5 px-4 text-center text-xs font-mono text-slate-400">
                        ${idx + 1}
                    </td>

                    <!-- 1st Column: Date -->
                    <td class="py-3.5 px-4 whitespace-nowrap">
                        <div class="font-bold text-xs text-slate-900">${formatDate(c.dispatch_date)}</div>
                        <span class="text-[10px] text-slate-400">By ${escapeHtml(c.uploaded_by || 'Staff')}</span>
                    </td>

                    <!-- 2nd Column: Total number of cartons -->
                    <td class="py-3.5 px-4 text-center whitespace-nowrap">
                        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                            ${c.total_cartons} Cartons
                        </span>
                        <span class="block text-[10px] text-slate-400 mt-0.5">Box ${c.carton_index || 1} of ${c.total_cartons}</span>
                    </td>

                    <!-- 3rd Column: Unique ID (AWB + Carton Association e.g. 12345678C1) -->
                    <td class="py-3.5 px-4 whitespace-nowrap">
                        <div class="flex items-center gap-1.5">
                            <span class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 font-mono font-bold text-xs tracking-wider">
                                ${c.carton_unique_id}
                            </span>
                        </div>
                        <span class="text-[10px] text-slate-400 font-mono mt-0.5 block">AWB: ${c.awb_number}</span>
                    </td>

                    <!-- 4th Column: Name of Party -->
                    <td class="py-3.5 px-4">
                        <div class="font-bold text-xs text-slate-900">${escapeHtml(c.customer_name)}</div>
                        ${c.shipment_unique_id ? `<span class="text-[10px] text-slate-400 font-mono truncate block max-w-[180px]">${c.shipment_unique_id}</span>` : ''}
                    </td>

                    <!-- 5th Column: Fan Name -->
                    <td class="py-3.5 px-4">
                        <div class="font-semibold text-xs text-slate-800">${escapeHtml(c.fan_name || 'Standard Fan')}</div>
                    </td>

                    <!-- 6th Column: Fan Images Gallery -->
                    <td class="py-3.5 px-4 whitespace-nowrap">
                        ${photoCount > 0 ? `
                            <div class="flex items-center gap-2.5">
                                <div class="fan-thumb-wrapper w-12 h-12 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 shadow-2xs relative" 
                                     onclick="window.openCartonGalleryById('${c.id}')">
                                    <img src="${primaryThumb}" alt="${escapeHtml(c.fan_name)}" class="w-full h-full object-cover">
                                    <div class="hover-overlay">
                                        <i data-lucide="zoom-in" class="w-3.5 h-3.5"></i>
                                    </div>
                                </div>
                                <div class="flex flex-col">
                                    <button type="button" 
                                            onclick="window.openCartonGalleryById('${c.id}')"
                                            class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg border border-emerald-200 transition-colors">
                                        <i data-lucide="images" class="w-3 h-3 text-emerald-600"></i>
                                        <span>${photoCount} Photo${photoCount > 1 ? 's' : ''}</span>
                                    </button>
                                    <button type="button" 
                                            onclick="window.openCartonGalleryById('${c.id}')"
                                            class="text-[10px] text-slate-400 hover:text-emerald-700 font-medium underline text-left mt-0.5">
                                        View Gallery
                                    </button>
                                </div>
                            </div>
                        ` : `
                            <div class="flex items-center gap-2 text-slate-400">
                                <div class="w-10 h-10 rounded-xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center">
                                    <i data-lucide="image-off" class="w-4 h-4"></i>
                                </div>
                                <span class="text-[11px]">No photos</span>
                            </div>
                        `}
                    </td>

                    <!-- Actions -->
                    <td class="py-3.5 px-4 text-center whitespace-nowrap">
                        <div class="flex items-center justify-center gap-1.5">
                            <button onclick="window.toggleCartonDispatch('${c.id}')" 
                                    class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                                        isDispatched 
                                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' 
                                            : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                    }" title="Click to toggle status">
                                <span class="w-1.5 h-1.5 rounded-full ${isDispatched ? 'bg-emerald-600' : 'bg-amber-600'}"></span>
                                <span>${c.status || 'Ready'}</span>
                            </button>
                            <button onclick="window.deleteCartonRecord('${c.id}')" 
                                    class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors" title="Delete Carton">
                                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    };

    window.clearLedgerFilters = function () {
        const s = document.getElementById('ledgerSearchInput');
        const d = document.getElementById('filterDateInput');
        const p = document.getElementById('filterPartySelect');
        const u = document.getElementById('filterUploaderSelect');
        if (s) s.value = '';
        if (d) d.value = '';
        if (p) p.value = '';
        if (u) u.value = '';
        window.renderLedgerTable();
    };

    window.exportCurrentLedger = function () {
        DispatchService.exportToExcel(state.allCartons);
    };

    window.toggleCartonDispatch = async function (cartonId) {
        const newStatus = await DispatchService.toggleDispatchStatus(cartonId);
        showToast(`Status updated: ${newStatus}`, 'success');
        window.renderLedgerTable();
    };

    window.deleteCartonRecord = async function (cartonId) {
        if (!confirm('Delete this carton record?')) return;
        await DispatchService.deleteCarton(cartonId);
        state.allCartons = state.allCartons.filter(c => c.id !== cartonId);
        window.renderLedgerTable();
        showToast('Carton deleted.', 'success');
    };

    // --------------------------------------------------------------------------
    // 10. MULTI-PHOTO LIGHTBOX GALLERY WITH FILMSTRIP & ARROWS
    // --------------------------------------------------------------------------
    const lightboxState = {
        photos: [],
        currentIndex: 0,
        fanName: '',
        cartonUid: '',
        partyName: ''
    };

    window.openCartonGalleryById = function (cartonId) {
        const carton = state.allCartons.find(c => c.id === cartonId);
        if (!carton) return;
        const photos = carton.photos && carton.photos.length > 0 ? carton.photos : (carton.image_url ? [carton.image_url] : []);
        window.openLightboxGallery(photos, 0, carton.fan_name, carton.carton_unique_id, carton.customer_name);
    };

    window.previewCartonPhotoGallery = function (cartonIndex, photoIndex = 0) {
        const row = state.currentCartonRows.find(r => r.carton_index === cartonIndex);
        if (!row || !row.photos || row.photos.length === 0) return;
        const party = document.getElementById('inputPartyName')?.value.trim() || 'Customer';
        window.openLightboxGallery(row.photos, photoIndex, row.fan_name, row.carton_unique_id, party);
    };

    window.openLightboxGallery = function (photosArray = [], startIndex = 0, fanName = '', cartonUid = '', partyName = '') {
        const modal = document.getElementById('imageLightboxModal');
        if (!modal) return;

        lightboxState.photos = Array.isArray(photosArray) && photosArray.length > 0 ? photosArray : [];
        lightboxState.currentIndex = Math.max(0, Math.min(startIndex, lightboxState.photos.length - 1));
        lightboxState.fanName = fanName || 'Carton Fan';
        lightboxState.cartonUid = cartonUid || 'Carton';
        lightboxState.partyName = partyName || '';

        renderLightboxView();
        modal.classList.remove('hidden');

        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    };

    function renderLightboxView() {
        const img = document.getElementById('lightboxImage');
        const title = document.getElementById('lightboxFanTitle');
        const meta = document.getElementById('lightboxCartonMeta');
        const counter = document.getElementById('lightboxPhotoCounter');
        const party = document.getElementById('lightboxPartyName');
        const download = document.getElementById('lightboxDownloadBtn');
        const filmstrip = document.getElementById('lightboxThumbnailsStrip');
        const prevBtn = document.getElementById('lightboxPrevBtn');
        const nextBtn = document.getElementById('lightboxNextBtn');

        const total = lightboxState.photos.length;
        const current = lightboxState.currentIndex;
        const currentUrl = lightboxState.photos[current] || '';

        if (img) img.src = currentUrl;
        if (title) title.textContent = lightboxState.fanName;
        if (meta) meta.textContent = `Unique ID: ${lightboxState.cartonUid}`;
        if (party) party.textContent = lightboxState.partyName ? `Party: ${lightboxState.partyName}` : '';
        if (counter) counter.textContent = total > 0 ? `${current + 1} / ${total}` : '0 / 0';

        if (download) {
            download.href = currentUrl;
            download.download = `${lightboxState.cartonUid}_photo_${current + 1}.jpg`;
        }

        // Show/hide navigation arrows if multiple photos
        if (prevBtn) prevBtn.style.display = total > 1 ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = total > 1 ? 'flex' : 'none';

        // Render Filmstrip
        if (filmstrip) {
            if (total > 1) {
                filmstrip.style.display = 'flex';
                filmstrip.innerHTML = lightboxState.photos.map((url, idx) => `
                    <div onclick="window.jumpLightboxTo(${idx})" 
                         class="w-12 h-12 rounded-lg overflow-hidden border-2 cursor-pointer transition-all shrink-0 ${idx === current ? 'border-emerald-400 scale-105 shadow-md' : 'border-white/20 opacity-60 hover:opacity-100'}">
                        <img src="${url}" alt="Thumbnail ${idx + 1}" class="w-full h-full object-cover">
                    </div>
                `).join('');
            } else {
                filmstrip.style.display = 'none';
            }
        }
    }

    window.navLightbox = function (direction) {
        const total = lightboxState.photos.length;
        if (total <= 1) return;
        lightboxState.currentIndex = (lightboxState.currentIndex + direction + total) % total;
        renderLightboxView();
    };

    window.jumpLightboxTo = function (index) {
        if (index >= 0 && index < lightboxState.photos.length) {
            lightboxState.currentIndex = index;
            renderLightboxView();
        }
    };

    window.closeLightbox = function () {
        document.getElementById('imageLightboxModal')?.classList.add('hidden');
    };

    // Keyboard navigation (ArrowLeft, ArrowRight, Escape)
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('imageLightboxModal');
        if (!modal || modal.classList.contains('hidden')) return;

        if (e.key === 'ArrowLeft') {
            window.navLightbox(-1);
        } else if (e.key === 'ArrowRight') {
            window.navLightbox(1);
        } else if (e.key === 'Escape') {
            window.closeLightbox();
        }
    });

    // --------------------------------------------------------------------------
    // 11. SETTINGS & SALES TEAM DIRECTORY (ADD & DELETE)
    // --------------------------------------------------------------------------
    window.renderTeamDirectory = function () {
        const tbody = document.getElementById('teamDirectoryTableBody');
        if (!tbody) return;

        if (state.teamMembers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-xs text-slate-400">No team members added yet. Click "+ Add Team Member".</td></tr>`;
            return;
        }

        tbody.innerHTML = state.teamMembers.map((m, idx) => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="py-3 px-4 font-bold text-slate-900">
                    <div class="flex items-center space-x-2">
                        <div class="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-[10px]">
                            ${escapeHtml((m.name || 'TM').substring(0, 2).toUpperCase())}
                        </div>
                        <span>${escapeHtml(m.name || 'Unnamed')}</span>
                    </div>
                </td>
                <td class="py-3 px-4">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                        ${escapeHtml(m.role || 'Sales Team')}
                    </span>
                </td>
                <td class="py-3 px-4 font-mono text-slate-500">
                    ${escapeHtml(m.employee_id || 'N/A')}
                </td>
                <td class="py-3 px-4 text-slate-500">
                    <div>${escapeHtml(m.phone || 'No phone')}</div>
                    <div class="text-[10px] text-slate-400">${escapeHtml(m.email || '')}</div>
                </td>
                <td class="py-3 px-4 text-center">
                    <button type="button" onclick="window.handleDeleteMember(${idx})" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer" title="Delete Team Member">
                        <i data-lucide="trash" class="w-4 h-4"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    };

    window.saveInlineMember = async function () {
        const nameInput = document.getElementById('inlineMemberName');
        const roleInput = document.getElementById('inlineMemberRole');
        const empIdInput = document.getElementById('inlineMemberEmpId');
        const phoneInput = document.getElementById('inlineMemberPhone');

        const name = (nameInput?.value || '').trim();
        const role = (roleInput?.value || 'Sales Representative').trim();
        const empId = (empIdInput?.value || '').trim() || `EMP-${Math.floor(100 + Math.random() * 900)}`;
        const phone = (phoneInput?.value || '').trim();

        if (!name) {
            showToast('Please enter member name.', 'error');
            nameInput?.focus();
            return;
        }

        try {
            await TeamService.addMember({ name, role, employee_id: empId, phone, email: '' });
            showToast(`Added "${name}" to sales team!`, 'success');
            if (nameInput) nameInput.value = '';
            if (empIdInput) empIdInput.value = '';
            if (phoneInput) phoneInput.value = '';
            window.renderTeamDirectory();
            populateUploaderDropdown();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    window.openAddMemberModal = function () {
        const modal = document.getElementById('addMemberModal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            modal.style.display = 'flex';
            setTimeout(() => {
                const input = document.getElementById('newMemberName');
                if (input) {
                    input.value = '';
                    input.focus();
                }
            }, 60);
        }
    };

    window.closeAddMemberModal = function () {
        const modal = document.getElementById('addMemberModal');
        if (modal) {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
    };

    window.saveNewTeamMember = async function () {
        const nameInput = document.getElementById('newMemberName');
        const roleInput = document.getElementById('newMemberRole');
        const empIdInput = document.getElementById('newMemberEmpId');
        const phoneInput = document.getElementById('newMemberPhone');
        const emailInput = document.getElementById('newMemberEmail');

        const name = (nameInput?.value || '').trim();
        const role = (roleInput?.value || 'Sales Representative').trim();
        const empId = (empIdInput?.value || '').trim() || `EMP-${Math.floor(100 + Math.random() * 900)}`;
        const phone = (phoneInput?.value || '').trim();
        const email = (emailInput?.value || '').trim();

        if (!name) {
            showToast('Member name is required.', 'error');
            nameInput?.focus();
            return;
        }

        try {
            await TeamService.addMember({ name, role, employee_id: empId, phone, email });
            showToast(`Added ${name} to sales team!`, 'success');
            window.closeAddMemberModal();
            if (nameInput) nameInput.value = '';
            if (empIdInput) empIdInput.value = '';
            if (phoneInput) phoneInput.value = '';
            if (emailInput) emailInput.value = '';
            window.renderTeamDirectory();
            populateUploaderDropdown();
        } catch (err) {
            showToast(`Failed: ${err.message}`, 'error');
        }
    };

    window.handleAddMemberSubmit = window.saveNewTeamMember;

    window.handleDeleteMember = async function (idOrIdx) {
        let name = 'Team member';
        if (typeof idOrIdx === 'number' && state.teamMembers && state.teamMembers[idOrIdx]) {
            name = state.teamMembers[idOrIdx].name;
        } else {
            const found = (state.teamMembers || []).find(m => String(m.id) === String(idOrIdx) || m.name === idOrIdx);
            if (found) name = found.name;
        }

        await TeamService.deleteMember(idOrIdx, name);
        showToast(`Removed "${name}" from sales team.`, 'success');
        window.renderTeamDirectory();
        populateUploaderDropdown();
    };

    function populateUploaderDropdown() {
        const select = document.getElementById('selectUploadedBy');
        if (!select) return;

        select.innerHTML = '<option value="">-- Choose Team Member --</option>' +
            state.teamMembers.map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} (${escapeHtml(m.role || 'Sales')})</option>`).join('');

        if (state.teamMembers.length > 0 && !select.value) {
            select.value = state.teamMembers[0].name;
            updateBatchIdPreview();
        }
    }

    // --------------------------------------------------------------------------
    // 12. SUPABASE CONFIGURATION & DIAGNOSTICS
    // --------------------------------------------------------------------------
    const SCHEMA_SQL_CONTENT = `-- Warehouse ERP PostgreSQL Schema for Supabase
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.sales_team (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(100) DEFAULT 'Sales Team',
    employee_id VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.warehouse_dispatches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    awb_number VARCHAR(100) NOT NULL,
    total_cartons INTEGER NOT NULL DEFAULT 1,
    customer_name VARCHAR(255) NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL,
    shipment_unique_id VARCHAR(255) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.warehouse_cartons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispatch_id UUID REFERENCES public.warehouse_dispatches(id) ON DELETE CASCADE,
    carton_index INTEGER NOT NULL,
    carton_unique_id VARCHAR(150) NOT NULL,
    awb_number VARCHAR(100) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    fan_name VARCHAR(255) NOT NULL,
    image_url TEXT,
    additional_images JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dispatches_date ON public.warehouse_dispatches(dispatch_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_awb ON public.warehouse_dispatches(awb_number);
CREATE INDEX IF NOT EXISTS idx_cartons_dispatch_id ON public.warehouse_cartons(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_cartons_unique_id ON public.warehouse_cartons(carton_unique_id);

ALTER TABLE public.sales_team ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_cartons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access to sales team" ON public.sales_team;
CREATE POLICY "Public access to sales team" ON public.sales_team FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to dispatches" ON public.warehouse_dispatches;
CREATE POLICY "Public access to dispatches" ON public.warehouse_dispatches FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to cartons" ON public.warehouse_cartons;
CREATE POLICY "Public access to cartons" ON public.warehouse_cartons FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

INSERT INTO public.sales_team (name, email, phone, role, employee_id, is_active)
VALUES 
    ('Rahul Sharma', 'rahul.sharma@example.com', '+91 98765 43210', 'Sales Manager', 'EMP-101', true),
    ('Priya Patel', 'priya.patel@example.com', '+91 98765 43211', 'Warehouse Supervisor', 'EMP-102', true),
    ('Amit Verma', 'amit.verma@example.com', '+91 98765 43212', 'Sales Representative', 'EMP-103', true),
    ('Vikram Singh', 'vikram.singh@example.com', '+91 98765 43213', 'Dispatch Officer', 'EMP-104', true)
ON CONFLICT DO NOTHING;

INSERT INTO storage.buckets (id, name, public) VALUES ('warehouse-photos', 'warehouse-photos', true) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Public access to warehouse photos" ON storage.objects;
CREATE POLICY "Public access to warehouse photos" ON storage.objects FOR ALL TO anon, authenticated USING (bucket_id = 'warehouse-photos') WITH CHECK (bucket_id = 'warehouse-photos');`;

    window.saveSupabaseConfig = async function () {
        const urlInput = document.getElementById('inputSupabaseUrl');
        const keyInput = document.getElementById('inputSupabaseKey');
        const saveBtn = document.getElementById('saveSupabaseBtn');
        const statusBox = document.getElementById('supabaseConnectionStatusBox');

        let url = urlInput?.value.trim().replace(/\/+$/, '') || '';
        let key = keyInput?.value.trim().replace(/^["']|["']$/g, '') || '';

        if (!url || !key) {
            showToast('Enter both Supabase URL and Anon key.', 'error');
            if (statusBox) {
                statusBox.className = 'rounded-xl p-3.5 text-xs bg-rose-50 text-rose-800 border border-rose-200 block';
                statusBox.innerHTML = '<div class="font-bold flex items-center gap-1.5"><i data-lucide="alert-circle" class="w-4 h-4 text-rose-600"></i> Missing Information</div><p class="mt-1">Please enter both your Supabase Project URL and Anon Public API Key.</p>';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
            return;
        }

        // Show loading state
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="inline-block animate-spin mr-1.5">⏳</span> Testing Connection...';
        }
        if (statusBox) {
            statusBox.className = 'rounded-xl p-3.5 text-xs bg-blue-50 text-blue-900 border border-blue-200 block';
            statusBox.innerHTML = `<div class="font-bold flex items-center gap-1.5"><span class="animate-spin inline-block mr-1">⏳</span> Connecting to Supabase project...</div><p class="mt-1 text-blue-700 font-mono text-[11px]">${escapeHtml(url)}</p>`;
        }

        AppConfig.saveConfig(url, key);
        SupabaseManager.resetClient();

        try {
            const test = await SupabaseManager.testConnection();
            const projectRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || '';
            const directSqlUrl = projectRef ? `https://supabase.com/dashboard/project/${projectRef}/sql/new` : 'https://supabase.com/dashboard';

            if (test.success) {
                showToast('Connected to Supabase successfully!', 'success');
                updateBadgeState(true, 'Connected (Live Supabase)');
                state.teamMembers = await TeamService.getAllMembers();
                state.allCartons = await DispatchService.getAllCartons();
                window.renderTeamDirectory();
                window.renderLedgerTable();

                if (statusBox) {
                    statusBox.className = 'rounded-xl p-3.5 text-xs bg-emerald-50 text-emerald-900 border border-emerald-300 block space-y-1';
                    statusBox.innerHTML = `
                        <div class="font-bold flex items-center gap-1.5 text-emerald-800">
                            <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600"></i>
                            Live Supabase Connection Verified!
                        </div>
                        <p class="text-emerald-700">
                            Database tables and photo storage bucket (<strong>${escapeHtml(AppConfig.storageBucketName)}</strong>) are fully connected and active.
                        </p>
                    `;
                }
            } else if (test.mode === 'missing_tables') {
                updateBadgeState(false, 'Tables Missing in Supabase');
                showToast('Connected! Please run schema.sql to create tables.', 'info');

                if (statusBox) {
                    statusBox.className = 'rounded-xl p-3.5 text-xs bg-amber-50 text-amber-950 border border-amber-300 block space-y-2';
                    statusBox.innerHTML = `
                        <div class="font-bold flex items-center gap-1.5 text-amber-900">
                            <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-600"></i>
                            Supabase Project Connected, but Warehouse Tables are Missing!
                        </div>
                        <p class="text-amber-800 leading-relaxed">
                            Your credentials for <strong>${escapeHtml(url)}</strong> are valid. However, the database tables (<code>sales_team</code>, <code>warehouse_dispatches</code>, <code>warehouse_cartons</code>) have not been created in your Supabase project yet.
                        </p>
                        <div class="flex flex-wrap items-center gap-2 pt-1">
                            <button type="button" onclick="window.copySchemaSql()" class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold rounded-lg flex items-center gap-1.5 shadow-xs transition-all">
                                <i data-lucide="copy" class="w-3.5 h-3.5"></i> 1. Copy schema.sql
                            </button>
                            <a href="${directSqlUrl}" target="_blank" class="px-3.5 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold rounded-lg flex items-center gap-1.5 transition-all">
                                <i data-lucide="external-link" class="w-3.5 h-3.5"></i> 2. Open Supabase SQL Editor
                            </a>
                        </div>
                        <p class="text-[11px] text-amber-700">
                            Paste into Supabase SQL Editor, click <strong>Run</strong>, then click <strong>Save & Test Connection</strong> here!
                        </p>
                    `;
                }
            } else {
                updateBadgeState(false, 'Offline / Error');
                showToast(test.message, 'error');

                if (statusBox) {
                    statusBox.className = 'rounded-xl p-3.5 text-xs bg-rose-50 text-rose-950 border border-rose-300 block space-y-1.5';
                    statusBox.innerHTML = `
                        <div class="font-bold flex items-center gap-1.5 text-rose-900">
                            <i data-lucide="alert-circle" class="w-4 h-4 text-rose-600"></i>
                            Connection Failed
                        </div>
                        <p class="text-rose-800 leading-relaxed">
                            ${escapeHtml(test.message)}
                        </p>
                        <div class="text-[11px] text-rose-700 pt-1 border-t border-rose-200">
                            <strong>Tip:</strong> In Supabase, go to <strong>Project Settings ⚙️ -> API</strong> and ensure you copy the <strong>anon public</strong> key (starts with <code>eyJ...</code>), NOT the service_role key.
                        </div>
                    `;
                }
            }
        } catch (err) {
            updateBadgeState(false, 'Connection Error');
            showToast(err.message, 'error');
            if (statusBox) {
                statusBox.className = 'rounded-xl p-3.5 text-xs bg-rose-50 text-rose-950 border border-rose-300 block space-y-1';
                statusBox.innerHTML = `
                    <div class="font-bold text-rose-900">Error Connecting to Supabase</div>
                    <p class="text-rose-800">${escapeHtml(err.message)}</p>
                `;
            }
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Save & Test Connection';
            }
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        }
    };

    window.forceSaveSupabaseConfig = async function () {
        const urlInput = document.getElementById('inputSupabaseUrl');
        const keyInput = document.getElementById('inputSupabaseKey');
        const statusBox = document.getElementById('supabaseConnectionStatusBox');

        let url = urlInput?.value.trim().replace(/\/+$/, '') || '';
        let key = keyInput?.value.trim().replace(/^["']|["']$/g, '') || '';

        if (!url || !key) {
            showToast('Enter both Supabase URL and Anon key.', 'error');
            if (statusBox) {
                statusBox.className = 'rounded-xl p-3.5 text-xs bg-rose-50 text-rose-800 border border-rose-200 block';
                statusBox.innerHTML = '<div class="font-bold flex items-center gap-1.5"><i data-lucide="alert-circle" class="w-4 h-4 text-rose-600"></i> Missing Information</div><p class="mt-1">Please enter both your Supabase Project URL and Anon Public API Key before saving.</p>';
                if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            }
            return;
        }

        AppConfig.saveConfig(url, key);
        SupabaseManager.resetClient();
        updateBadgeState(true, 'Connected (Live Supabase)');
        showToast('Supabase configuration saved! Live mode active.', 'success');

        if (statusBox) {
            statusBox.className = 'rounded-xl p-3.5 text-xs bg-emerald-50 text-emerald-900 border border-emerald-300 block space-y-1';
            statusBox.innerHTML = `
                <div class="font-bold flex items-center gap-1.5 text-emerald-800">
                    <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600"></i>
                    Credentials Saved Directly!
                </div>
                <p class="text-emerald-700">
                    Configuration saved for <strong>${escapeHtml(url)}</strong>. Live Supabase mode is now active.
                </p>
            `;
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        }

        // Background sync team members and cartons without blocking UI
        try {
            state.teamMembers = await TeamService.getAllMembers();
            state.allCartons = await DispatchService.getAllCartons();
            window.renderTeamDirectory();
            window.renderLedgerTable();
        } catch (e) {
            console.warn('[forceSaveSupabaseConfig] Background sync note:', e);
        }
    };


    window.toggleSupabaseKeyVisibility = function () {
        const input = document.getElementById('inputSupabaseKey');
        const text = document.getElementById('toggleKeyText');
        if (!input) return;

        if (input.type === 'password') {
            input.type = 'text';
            if (text) text.textContent = 'Hide Key';
        } else {
            input.type = 'password';
            if (text) text.textContent = 'Show Key';
        }
    };

    window.copySchemaSql = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(SCHEMA_SQL_CONTENT).then(() => {
                showToast('schema.sql copied to clipboard! Paste it into Supabase SQL Editor.', 'success');
            }).catch(() => {
                fallbackCopy(SCHEMA_SQL_CONTENT);
            });
        } else {
            fallbackCopy(SCHEMA_SQL_CONTENT);
        }
    };

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('schema.sql copied to clipboard!', 'success');
    }

    window.clearSupabaseConfig = function () {
        AppConfig.clearConfig();
        SupabaseManager.resetClient();
        updateBadgeState(false, 'Demo Mode (Offline)');
        const statusBox = document.getElementById('supabaseConnectionStatusBox');
        if (statusBox) {
            statusBox.className = 'hidden';
            statusBox.innerHTML = '';
        }
        showToast('Switched to Demo Mode.', 'info');
    };

    function updateBadgeState(isLive, label) {
        const badge = document.getElementById('connectionBadge');
        const pill = document.getElementById('supabaseStatusPill');

        if (badge) {
            badge.className = isLive
                ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800'
                : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800';
            badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-500'} mr-1"></span> ${label}`;
        }
        if (pill) {
            pill.className = isLive
                ? 'text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-800'
                : 'text-xs px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800';
            pill.textContent = label;
        }
    }

    // --------------------------------------------------------------------------
    // 13. UTILITIES & BOOTSTRAPPER
    // --------------------------------------------------------------------------
    function updateBatchIdPreview() {
        const dateVal = document.getElementById('inputDispatchDate')?.value || new Date().toISOString().split('T')[0];
        const awbVal = document.getElementById('inputAwbNumber')?.value.trim().toUpperCase() || 'AWB';
        const partyVal = document.getElementById('inputPartyName')?.value.trim() || 'CUSTOMER';
        const uploaderVal = document.getElementById('selectUploadedBy')?.value.trim() || 'UPLOADER';

        const cleanDate = dateVal.replace(/-/g, '');
        const cleanParty = partyVal.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase() || 'CUST';
        const cleanUploader = uploaderVal.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase() || 'USER';

        const previewEl = document.getElementById('previewBatchUniqueId');
        if (previewEl) {
            previewEl.innerHTML = `<span>WH-${cleanDate}-${cleanParty}-${cleanUploader}-${awbVal}</span><i data-lucide="fingerprint" class="w-4 h-4 text-emerald-600"></i>`;
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
        }
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const d = new Date(parts[0], parts[1] - 1, parts[2]);
                return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            }
            return dateStr;
        } catch {
            return dateStr;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showToast(message, type = 'info') {
        const toast = document.getElementById('toastNotification');
        const text = document.getElementById('toastMessage');
        const icon = document.getElementById('toastIcon');
        if (!toast || !text) return;

        text.textContent = message;
        if (icon) {
            icon.className = type === 'success' ? 'w-5 h-5 text-emerald-400' :
                             type === 'error' ? 'w-5 h-5 text-rose-400' : 'w-5 h-5 text-blue-400';
        }

        toast.classList.remove('translate-y-24', 'opacity-0', 'pointer-events-none');
        setTimeout(() => {
            toast.classList.add('translate-y-24', 'opacity-0', 'pointer-events-none');
        }, 3500);
    }

    async function initApp() {
        const dateInput = document.getElementById('inputDispatchDate');
        if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

        const clockEl = document.getElementById('liveClock');
        if (clockEl) {
            const updateTime = () => {
                const now = new Date();
                clockEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' • ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            };
            updateTime();
            setInterval(updateTime, 30000);
        }

        const urlInput = document.getElementById('inputSupabaseUrl');
        const keyInput = document.getElementById('inputSupabaseKey');
        if (urlInput) urlInput.value = AppConfig.supabaseUrl || '';
        if (keyInput) keyInput.value = AppConfig.supabaseAnonKey || '';

        const test = await SupabaseManager.testConnection();
        updateBadgeState(test.success, test.success ? 'Connected (Live Supabase)' : 'Demo Mode (Offline)');

        state.teamMembers = await TeamService.getAllMembers();
        state.allCartons = await DispatchService.getAllCartons();

        populateUploaderDropdown();
        window.generateCartonRows();
        window.renderLedgerTable();
        window.renderTeamDirectory();
        PartyService.renderPartyControls();

        // Save party name on blur if entered
        document.getElementById('inputPartyName')?.addEventListener('blur', () => {
            const val = document.getElementById('inputPartyName')?.value.trim();
            if (val) {
                PartyService.saveParty(val);
            }
        });

        // Close party dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const container = document.getElementById('partyFieldContainer');
            if (container && !container.contains(e.target)) {
                window.closePartyDropdown();
            }
        });

        // Close Add Member modal when clicking outside content box
        document.getElementById('addMemberModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'addMemberModal') {
                window.closeAddMemberModal();
            }
        });

        // Close modals on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                window.closeAddMemberModal();
                window.closeLightbox();
                window.closePartyDropdown();
            }
        });

        document.getElementById('inputAwbNumber')?.addEventListener('input', () => {
            updateBatchIdPreview();
            const awb = (document.getElementById('inputAwbNumber')?.value || 'AWB').trim().toUpperCase();
            state.currentCartonRows.forEach((r, idx) => {
                r.carton_unique_id = `${awb}C${idx + 1}`;
                const tag = document.getElementById(`cartonTag_${idx + 1}`);
                if (tag) tag.textContent = r.carton_unique_id;
            });
        });

        document.getElementById('inputTotalCartons')?.addEventListener('input', window.generateCartonRows);
        document.getElementById('inputPartyName')?.addEventListener('input', updateBatchIdPreview);
        document.getElementById('selectUploadedBy')?.addEventListener('change', updateBatchIdPreview);
        document.getElementById('inputDispatchDate')?.addEventListener('change', updateBatchIdPreview);

        updateBatchIdPreview();

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
