import { createClient } from '@supabase/supabase-js';

// Pegamos los datos directamente aquí para no usar 'import.meta'
const supabaseUrl = 'https://egbbweklilbapdylevlz.supabase.co';
const supabaseKey = 'sb_publishable___nmOxitfy-BwdiZl8z-Ow_kXz-QOcD';

export const supabase = createClient(supabaseUrl, supabaseKey);
