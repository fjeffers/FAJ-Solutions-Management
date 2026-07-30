-- Migration 050: what the CLIENT sees for a visit
--
-- site_visits.notes is dual-use. Hand-typed notes are exactly right for a client
-- report ('Add BLANKS to Rack'); notes on an imported visit can be the whole
-- assignment email, which reads as instructions to a tech and once carried
-- NetView's internal Smartsheet, bit.ly and Google Drive links.
--
-- client_summary is the deliberate, client-facing sentence. When it's set the
-- shared report uses it. When it isn't, the report falls back to notes only if
-- they're short enough to be a real work description — long ones are hidden
-- rather than truncated into something odd (see clientVisibleNote in
-- lib/site-report.ts).
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS client_summary TEXT;

-- Report RPC now returns client_summary alongside notes.
CREATE OR REPLACE FUNCTION public.get_shared_site_report(p_token text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_customer jsonb; v_cid uuid; v_uid uuid; v_visits jsonb;
BEGIN
  SELECT id, user_id, jsonb_build_object('name',name,'city',city,'state',state)
    INTO v_cid, v_uid, v_customer FROM customers WHERE share_token = p_token;
  IF v_cid IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'visit_date',v.visit_date,'site_name',v.site_name,'site_code',v.site_code,
      'address',v.address,'time_in',v.time_in,'time_out',v.time_out,'hours',v.hours,
      'visit_type',v.visit_type,'notes',v.notes,'client_summary',v.client_summary,
      'sessions',v.sessions)
    ORDER BY v.visit_date DESC NULLS LAST)
    INTO v_visits FROM site_visits v WHERE v.customer_id = v_cid AND v.user_id = v_uid;

  RETURN jsonb_build_object('customer', v_customer, 'visits', COALESCE(v_visits,'[]'::jsonb));
END;
$function$;
