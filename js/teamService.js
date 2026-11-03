// ==============================================================================
// SALES & WAREHOUSE TEAM SERVICE
// Handles Listing, Adding, and Deleting Sales Team members with Supabase & LocalStorage
// ==============================================================================

import { SupabaseManager } from './supabaseClient.js';

const TEAM_STORAGE_KEY = 'warehouse_erp_sales_team_members';

const DEFAULT_MEMBERS = [
    {
        id: '10110110-0001-4000-8000-000000000001',
        name: 'Rahul Sharma',
        role: 'Sales Manager',
        email: 'rahul.sharma@example.com',
        phone: '+91 98765 43210',
        employee_id: 'EMP-101',
        is_active: true,
        created_at: new Date(Date.now() - 86400000 * 5).toISOString()
    },
    {
        id: '10110110-0002-4000-8000-000000000002',
        name: 'Priya Patel',
        role: 'Warehouse Supervisor',
        email: 'priya.patel@example.com',
        phone: '+91 98765 43211',
        employee_id: 'EMP-102',
        is_active: true,
        created_at: new Date(Date.now() - 86400000 * 4).toISOString()
    },
    {
        id: '10110110-0003-4000-8000-000000000003',
        name: 'Amit Verma',
        role: 'Sales Representative',
        email: 'amit.verma@example.com',
        phone: '+91 98765 43212',
        employee_id: 'EMP-103',
        is_active: true,
        created_at: new Date(Date.now() - 86400000 * 3).toISOString()
    },
    {
        id: '10110110-0004-4000-8000-000000000004',
        name: 'Vikram Singh',
        role: 'Dispatch Officer',
        email: 'vikram.singh@example.com',
        phone: '+91 98765 43213',
        employee_id: 'EMP-104',
        is_active: true,
        created_at: new Date(Date.now() - 86400000 * 2).toISOString()
    }
];

export const TeamService = {
    // Get all team members (from Supabase if connected, else localStorage)
    async getAllMembers() {
        const client = SupabaseManager.getClient();

        if (client) {
            try {
                const { data, error } = await client
                    .from('sales_team')
                    .select('*')
                    .order('created_at', { ascending: true });

                if (!error && Array.isArray(data) && data.length > 0) {
                    // Update cache in localStorage
                    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(data));
                    return data;
                }
            } catch (err) {
                console.warn('[TeamService] Could not fetch from Supabase, using localStorage:', err);
            }
        }

        // LocalStorage fallback
        const local = localStorage.getItem(TEAM_STORAGE_KEY);
        if (local) {
            try {
                return JSON.parse(local);
            } catch (e) {
                console.error('Error parsing cached team members:', e);
            }
        }

        // Return initial defaults and save
        localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(DEFAULT_MEMBERS));
        return DEFAULT_MEMBERS;
    },

    // Add a new Sales Team member
    async addMember({ name, role, email, phone, employee_id }) {
        if (!name || !name.trim()) {
            throw new Error('Member name is required.');
        }

        const newMember = {
            id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            name: name.trim(),
            role: role ? role.trim() : 'Sales Representative',
            email: email ? email.trim() : '',
            phone: phone ? phone.trim() : '',
            employee_id: employee_id ? employee_id.trim() : `EMP-${Math.floor(100 + Math.random() * 900)}`,
            is_active: true,
            created_at: new Date().toISOString()
        };

        const client = SupabaseManager.getClient();
        if (client) {
            try {
                const { data, error } = await client
                    .from('sales_team')
                    .insert([{
                        name: newMember.name,
                        role: newMember.role,
                        email: newMember.email,
                        phone: newMember.phone,
                        employee_id: newMember.employee_id,
                        is_active: true
                    }])
                    .select()
                    .single();

                if (!error && data) {
                    newMember.id = data.id;
                }
            } catch (err) {
                console.warn('[TeamService] Supabase insert failed, storing locally:', err);
            }
        }

        // Update localStorage
        const members = await this.getAllMembers();
        members.push(newMember);
        localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(members));

        return newMember;
    },

    // Delete a Sales Team member by ID
    async deleteMember(id) {
        if (!id) throw new Error('Member ID is required to delete.');

        const client = SupabaseManager.getClient();
        if (client) {
            try {
                await client
                    .from('sales_team')
                    .delete()
                    .eq('id', id);
            } catch (err) {
                console.warn('[TeamService] Supabase delete failed:', err);
            }
        }

        // Update localStorage
        let members = await this.getAllMembers();
        members = members.filter(m => m.id !== id);
        localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(members));
        return true;
    },

    // Reset team members to default
    resetDefaults() {
        localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(DEFAULT_MEMBERS));
        return DEFAULT_MEMBERS;
    }
};
