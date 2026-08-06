// Supabase Edge Function: admin-user-ops
// Dipanggil dari AdminPanel untuk buat user baru, reset password,
// update email, dan nonaktifkan/aktifkan user (resign).
// Kode ini jalan di server Supabase (aman), bukan di browser user.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Buat client biasa untuk cek siapa yang memanggil
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: req.headers.get('Authorization') } } }
    )

    // Pastikan yang memanggil sudah login
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Pastikan yang memanggil adalah admin
    const { data: profile } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Access denied: admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Sekarang gunakan service role key (kunci rahasia, aman di server)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    const body = await req.json()
    const { action } = body

    // ---- ACTION: buat user baru ----
    if (action === 'create_user') {
      const { email, password, full_name, department, role } = body

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,          // langsung aktif, tidak perlu klik email
        user_metadata: { full_name, department, role }
      })

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true, user_id: data.user.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ---- ACTION: reset password user ----
    if (action === 'update_password') {
      const { user_id, new_password } = body

      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        password: new_password
      })

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ---- ACTION: update email user ----
    if (action === 'update_email') {
      const { user_id, new_email } = body

      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        email: new_email,
        email_confirm: true
      })

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ---- ACTION: hapus user sepenuhnya dari auth.users ----
    // profiles akan terhapus otomatis karena ON DELETE CASCADE
    // CATATAN: dibiarkan tetap ada untuk kompatibilitas lama, tapi AdminPanel
    // sekarang sudah tidak memanggil action ini lagi -- dipakai 'deactivate_user'
    // sebagai gantinya supaya riwayat transaksi user tidak hilang/gagal karena FK.
    if (action === 'delete_user') {
      const { user_id } = body

      const { error } = await adminClient.auth.admin.deleteUser(user_id)

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ---- ACTION BARU: nonaktifkan user (resign) ----
    // Tidak menghapus apa pun -- cuma kunci login (ban) + tandai status di profiles.
    // Riwayat reimbursements/approval_history/cash_topups tetap utuh.
    if (action === 'deactivate_user') {
      const { user_id } = body

      const { error: banErr } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: '876000h', // Supabase tidak punya opsi "selamanya" literal
      })

      if (banErr) {
        return new Response(JSON.stringify({ error: banErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { error: profErr } = await adminClient
        .from('profiles')
        .update({ status: 'resigned', resigned_at: new Date().toISOString() })
        .eq('id', user_id)

      if (profErr) {
        return new Response(JSON.stringify({ error: profErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ---- ACTION BARU: aktifkan kembali user ----
    if (action === 'reactivate_user') {
      const { user_id } = body

      const { error: unbanErr } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: 'none',
      })

      if (unbanErr) {
        return new Response(JSON.stringify({ error: unbanErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { error: profErr } = await adminClient
        .from('profiles')
        .update({ status: 'active', resigned_at: null })
        .eq('id', user_id)

      if (profErr) {
        return new Response(JSON.stringify({ error: profErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
