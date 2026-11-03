// ==============================================================================
// WAREHOUSE DISPATCH & CARTON SERVICE
// Manages warehouse shipments, carton-level items, mandatory fan images, and Excel export
// ==============================================================================

import { SupabaseManager } from './supabaseClient.js';

const DISPATCH_STORAGE_KEY = 'warehouse_erp_dispatches_cache';
const CARTON_STORAGE_KEY = 'warehouse_erp_cartons_cache';

// Seed demo dispatches so app has realistic data upon initial load
const SEED_DISPATCHES = [
    {
        id: 'disp-20261101-001',
        dispatch_date: '2026-11-01',
        awb_number: '78291045',
        total_cartons: 4,
        customer_name: 'Apex Electricals Pvt Ltd',
        uploaded_by: 'Rahul Sharma',
        shipment_unique_id: 'WH-20261101-APEX-RAHUL-78291045',
        status: 'Dispatched',
        notes: 'Priority dispatch via BlueDart express',
        created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
        id: 'disp-20261102-002',
        dispatch_date: '2026-11-02',
        awb_number: '99401823',
        total_cartons: 3,
        customer_name: 'Metro Fan & Appliances',
        uploaded_by: 'Priya Patel',
        shipment_unique_id: 'WH-20261102-METRO-PRIYA-99401823',
        status: 'Ready for Dispatch',
        notes: 'Fragile handling stickers applied',
        created_at: new Date().toISOString()
    }
];

// Placeholder high-quality fan images (data URIs or clean SVG representations)
const SAMPLE_FAN_IMGS = [
    'https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1618220179428-22790b461013?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=600&auto=format&fit=crop&q=80'
];

const SEED_CARTONS = [
    {
        id: 'cart-1',
        dispatch_id: 'disp-20261101-001',
        carton_index: 1,
        carton_unique_id: '78291045C1',
        awb_number: '78291045',
        customer_name: 'Apex Electricals Pvt Ltd',
        uploaded_by: 'Rahul Sharma',
        dispatch_date: '2026-11-01',
        total_cartons: 4,
        fan_name: 'AeroStorm 1200mm Matte White',
        image_url: SAMPLE_FAN_IMGS[0],
        additional_images: [],
        status: 'Dispatched',
        created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
        id: 'cart-2',
        dispatch_id: 'disp-20261101-001',
        carton_index: 2,
        carton_unique_id: '78291045C2',
        awb_number: '78291045',
        customer_name: 'Apex Electricals Pvt Ltd',
        uploaded_by: 'Rahul Sharma',
        dispatch_date: '2026-11-01',
        total_cartons: 4,
        fan_name: 'BreezeMax High Speed Brown',
        image_url: SAMPLE_FAN_IMGS[1],
        additional_images: [],
        status: 'Dispatched',
        created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
        id: 'cart-3',
        dispatch_id: 'disp-20261101-001',
        carton_index: 3,
        carton_unique_id: '78291045C3',
        awb_number: '78291045',
        customer_name: 'Apex Electricals Pvt Ltd',
        uploaded_by: 'Rahul Sharma',
        dispatch_date: '2026-11-01',
        total_cartons: 4,
        fan_name: 'SilentPro BLDC 5-Star Ivory',
        image_url: SAMPLE_FAN_IMGS[2],
        additional_images: [],
        status: 'Dispatched',
        created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
        id: 'cart-4',
        dispatch_id: 'disp-20261101-001',
        carton_index: 4,
        carton_unique_id: '78291045C4',
        awb_number: '78291045',
        customer_name: 'Apex Electricals Pvt Ltd',
        uploaded_by: 'Rahul Sharma',
        dispatch_date: '2026-11-01',
        total_cartons: 4,
        fan_name: 'TurboAir Exhaust Fan 200mm Metallic',
        image_url: SAMPLE_FAN_IMGS[3],
        additional_images: [],
        status: 'Dispatched',
        created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
        id: 'cart-5',
        dispatch_id: 'disp-20261102-002',
        carton_index: 1,
        carton_unique_id: '99401823C1',
        awb_number: '99401823',
        customer_name: 'Metro Fan & Appliances',
        uploaded_by: 'Priya Patel',
        dispatch_date: '2026-11-02',
        total_cartons: 3,
        fan_name: 'EcoVent Pedestal 400mm Black',
        image_url: SAMPLE_FAN_IMGS[1],
        additional_images: [],
        status: 'Ready for Dispatch',
        created_at: new Date().toISOString()
    },
    {
        id: 'cart-6',
        dispatch_id: 'disp-20261102-002',
        carton_index: 2,
        carton_unique_id: '99401823C2',
        awb_number: '99401823',
        customer_name: 'Metro Fan & Appliances',
        uploaded_by: 'Priya Patel',
        dispatch_date: '2026-11-02',
        total_cartons: 3,
        fan_name: 'AeroStorm 1200mm Pearl Gold',
        image_url: SAMPLE_FAN_IMGS[0],
        additional_images: [],
        status: 'Ready for Dispatch',
        created_at: new Date().toISOString()
    },
    {
        id: 'cart-7',
        dispatch_id: 'disp-20261102-002',
        carton_index: 3,
        carton_unique_id: '99401823C3',
        awb_number: '99401823',
        customer_name: 'Metro Fan & Appliances',
        uploaded_by: 'Priya Patel',
        dispatch_date: '2026-11-02',
        total_cartons: 3,
        fan_name: 'AeroStorm 1200mm Pearl Gold',
        image_url: SAMPLE_FAN_IMGS[2],
        additional_images: [],
        status: 'Ready for Dispatch',
        created_at: new Date().toISOString()
    }
];

export const DispatchService = {
    // Fetch all cartons with joined dispatch information
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
                            shipment_unique_id,
                            notes
                        )
                    `)
                    .order('created_at', { ascending: false });

                if (!error && Array.isArray(data) && data.length > 0) {
                    // Flatten joined data
                    const formatted = data.map(item => {
                        const d = item.warehouse_dispatches || {};
                        return {
                            id: item.id,
                            dispatch_id: item.dispatch_id,
                            carton_index: item.carton_index,
                            carton_unique_id: item.carton_unique_id,
                            awb_number: item.awb_number,
                            customer_name: item.customer_name,
                            fan_name: item.fan_name,
                            image_url: item.image_url,
                            additional_images: item.additional_images || [],
                            dispatch_date: d.dispatch_date || new Date(item.created_at).toISOString().split('T')[0],
                            total_cartons: d.total_cartons || 1,
                            uploaded_by: d.uploaded_by || 'Warehouse Staff',
                            shipment_unique_id: d.shipment_unique_id || '',
                            notes: d.notes || '',
                            created_at: item.created_at
                        };
                    });

                    localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(formatted));
                    return formatted;
                }
            } catch (err) {
                console.warn('[DispatchService] Supabase fetch error, fallback to cache:', err);
            }
        }

        // Cache / LocalStorage fallback
        const local = localStorage.getItem(CARTON_STORAGE_KEY);
        if (local) {
            try {
                return JSON.parse(local);
            } catch (e) {
                console.error('Error parsing cached cartons:', e);
            }
        }

        localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(SEED_CARTONS));
        localStorage.setItem(DISPATCH_STORAGE_KEY, JSON.stringify(SEED_DISPATCHES));
        return SEED_CARTONS;
    },

    // Save a new Dispatch batch with its associated cartons
    async createDispatch({
        dispatch_date,
        awb_number,
        customer_name,
        uploaded_by,
        notes = '',
        cartons = []
    }) {
        if (!awb_number || !awb_number.trim()) {
            throw new Error('AWB Number is required.');
        }
        if (!customer_name || !customer_name.trim()) {
            throw new Error('Name of Party (Customer) is required.');
        }
        if (!uploaded_by || !uploaded_by.trim()) {
            throw new Error('Uploading person is required.');
        }
        if (!cartons || cartons.length === 0) {
            throw new Error('At least one carton is required.');
        }

        const cleanAWB = awb_number.trim().toUpperCase();
        const cleanCustomer = customer_name.trim();
        const cleanUploader = uploaded_by.trim();
        const totalCartons = cartons.length;
        const dateStr = dispatch_date || new Date().toISOString().split('T')[0];

        // Format Unique Shipment Batch ID: WH-YYYYMMDD-CUSTOMER-UPLOADER-AWB
        const safeCust = cleanCustomer.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
        const safeUploader = cleanUploader.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
        const safeDate = dateStr.replace(/-/g, '');
        const shipmentUniqueId = `WH-${safeDate}-${safeCust}-${safeUploader}-${cleanAWB}`;

        const dispatchId = 'disp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

        const newDispatch = {
            id: dispatchId,
            dispatch_date: dateStr,
            awb_number: cleanAWB,
            total_cartons: totalCartons,
            customer_name: cleanCustomer,
            uploaded_by: cleanUploader,
            shipment_unique_id: shipmentUniqueId,
            notes: notes ? notes.trim() : '',
            status: 'Ready for Dispatch',
            created_at: new Date().toISOString()
        };

        // Prepare carton records
        const newCartonRecords = [];

        for (let i = 0; i < cartons.length; i++) {
            const c = cartons[i];
            const cartonIndex = i + 1;
            // Requirement 3: Unique ID will be AWB associated with carton number, e.g. 12345678C1
            const cartonUniqueId = `${cleanAWB}C${cartonIndex}`;

            if (!c.fan_name || !c.fan_name.trim()) {
                throw new Error(`Fan Name is missing for Carton ${cartonIndex} (${cartonUniqueId}).`);
            }
            if (!c.image_url) {
                throw new Error(`Mandatory Fan Image is missing for Carton ${cartonIndex} (${cartonUniqueId}).`);
            }

            // Upload image to Supabase if live, or keep base64
            let finalImageUrl = c.image_url;
            if (c.image_url.startsWith('data:image')) {
                finalImageUrl = await SupabaseManager.uploadImage(c.image_url, `carton_${cartonUniqueId}`);
            }

            newCartonRecords.push({
                id: 'cart_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substring(2, 6),
                dispatch_id: dispatchId,
                carton_index: cartonIndex,
                carton_unique_id: cartonUniqueId,
                awb_number: cleanAWB,
                customer_name: cleanCustomer,
                uploaded_by: cleanUploader,
                dispatch_date: dateStr,
                total_cartons: totalCartons,
                fan_name: c.fan_name.trim(),
                image_url: finalImageUrl,
                additional_images: c.additional_images || [],
                status: 'Ready for Dispatch',
                created_at: new Date().toISOString()
            });
        }

        // Attempt Supabase insert
        const client = SupabaseManager.getClient();
        if (client) {
            try {
                // 1. Insert Master Dispatch
                const { data: dispData, error: dispError } = await client
                    .from('warehouse_dispatches')
                    .insert([{
                        dispatch_date: newDispatch.dispatch_date,
                        awb_number: newDispatch.awb_number,
                        total_cartons: newDispatch.total_cartons,
                        customer_name: newDispatch.customer_name,
                        uploaded_by: newDispatch.uploaded_by,
                        shipment_unique_id: newDispatch.shipment_unique_id,
                        notes: newDispatch.notes
                    }])
                    .select()
                    .single();

                if (!dispError && dispData) {
                    const serverDispatchId = dispData.id;
                    newDispatch.id = serverDispatchId;

                    // 2. Insert Cartons
                    const cartonsToInsert = newCartonRecords.map(c => ({
                        dispatch_id: serverDispatchId,
                        carton_index: c.carton_index,
                        carton_unique_id: c.carton_unique_id,
                        awb_number: c.awb_number,
                        customer_name: c.customer_name,
                        fan_name: c.fan_name,
                        image_url: c.image_url,
                        additional_images: c.additional_images
                    }));

                    const { data: insertedCartons, error: cartError } = await client
                        .from('warehouse_cartons')
                        .insert(cartonsToInsert)
                        .select();

                    if (!cartError && insertedCartons) {
                        for (let k = 0; k < insertedCartons.length; k++) {
                            newCartonRecords[k].id = insertedCartons[k].id;
                            newCartonRecords[k].dispatch_id = serverDispatchId;
                        }
                    }
                }
            } catch (err) {
                console.warn('[DispatchService] Supabase insert failed, continuing with local store:', err);
            }
        }

        // Update LocalStorage cache
        const allCartons = await this.getAllCartons();
        const updatedCartons = [...newCartonRecords, ...allCartons];
        localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(updatedCartons));

        return {
            dispatch: newDispatch,
            cartons: newCartonRecords
        };
    },

    // Delete a specific carton or dispatch
    async deleteCarton(cartonId) {
        if (!cartonId) return;

        const client = SupabaseManager.getClient();
        if (client) {
            try {
                await client
                    .from('warehouse_cartons')
                    .delete()
                    .eq('id', cartonId);
            } catch (err) {
                console.warn('[DispatchService] Supabase delete carton failed:', err);
            }
        }

        let allCartons = await this.getAllCartons();
        allCartons = allCartons.filter(c => c.id !== cartonId);
        localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(allCartons));
        return true;
    },

    // Toggle carton dispatch status
    async toggleDispatchStatus(cartonId) {
        let allCartons = await this.getAllCartons();
        const carton = allCartons.find(c => c.id === cartonId);
        if (!carton) return null;

        carton.status = carton.status === 'Dispatched' ? 'Ready for Dispatch' : 'Dispatched';
        localStorage.setItem(CARTON_STORAGE_KEY, JSON.stringify(allCartons));
        return carton.status;
    },

    // Export current ledger data to Excel (.xlsx) using SheetJS
    exportToExcel(cartonList = []) {
        if (!window.XLSX) {
            alert('SheetJS Excel library is not loaded. Please check your internet connection.');
            return;
        }

        if (!cartonList || cartonList.length === 0) {
            alert('No records available to export.');
            return;
        }

        // Prepare row data matching the user's required column order
        const dataRows = cartonList.map((item, idx) => ({
            'S.No': idx + 1,
            'Date': item.dispatch_date,
            'Total Cartons': item.total_cartons,
            'Unique ID (AWB+Carton)': item.carton_unique_id,
            'Name of Party': item.customer_name,
            'Fan Name': item.fan_name,
            'Image Status': item.image_url ? 'Mandatory Photo Attached' : 'Missing',
            'Image URL / Preview': item.image_url && !item.image_url.startsWith('data:') ? item.image_url : 'Embedded In-App',
            'Uploaded By': item.uploaded_by || 'Warehouse Staff',
            'AWB Number': item.awb_number,
            'Shipment Batch ID': item.shipment_unique_id || '',
            'Status': item.status || 'Ready for Dispatch',
            'Timestamp': item.created_at
        }));

        const worksheet = window.XLSX.utils.json_to_sheet(dataRows);

        // Auto-fit column widths
        const colWidths = [
            { wch: 6 },  // S.No
            { wch: 12 }, // Date
            { wch: 14 }, // Total Cartons
            { wch: 18 }, // Unique ID
            { wch: 28 }, // Name of Party
            { wch: 32 }, // Fan Name
            { wch: 24 }, // Image Status
            { wch: 40 }, // Image URL
            { wch: 20 }, // Uploaded By
            { wch: 16 }, // AWB
            { wch: 34 }, // Shipment Batch ID
            { wch: 18 }, // Status
            { wch: 22 }  // Timestamp
        ];
        worksheet['!cols'] = colWidths;

        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Warehouse Dispatches');

        const fileName = `Warehouse_ERP_Dispatches_${new Date().toISOString().split('T')[0]}.xlsx`;
        window.XLSX.writeFile(workbook, fileName);
    }
};
