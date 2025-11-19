-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'auditor', 'manager', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- RLS policy: Users can view their own roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- RLS policy: Only admins can insert roles
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RLS policy: Only admins can update roles
CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS policy: Only admins can delete roles
CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Update audit log policies to be admin-only for reading
DROP POLICY IF EXISTS "authenticated_view_own_audit_logs" ON public.bank_audit_log;
CREATE POLICY "Only admins can view audit logs"
ON public.bank_audit_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Make audit logs append-only (no updates/deletes for anyone)
CREATE POLICY "No one can update audit logs"
ON public.bank_audit_log
FOR UPDATE
TO authenticated
USING (false);

CREATE POLICY "No one can delete audit logs"
ON public.bank_audit_log
FOR DELETE
TO authenticated
USING (false);

-- Update collection_report policies with role-based access
DROP POLICY IF EXISTS "authenticated_view_collections" ON public.collection_report;
DROP POLICY IF EXISTS "authenticated_update_collections" ON public.collection_report;
DROP POLICY IF EXISTS "authenticated_delete_collections" ON public.collection_report;

CREATE POLICY "Authenticated users can view collections"
ON public.collection_report
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'manager') OR
  public.has_role(auth.uid(), 'auditor') OR
  public.has_role(auth.uid(), 'user')
);

CREATE POLICY "Only admins and managers can update collections"
ON public.collection_report
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'manager')
);

CREATE POLICY "Only admins can delete collections"
ON public.collection_report
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Update universal_bank_reports policies with role-based access
DROP POLICY IF EXISTS "authenticated_update_bank_reports" ON public.universal_bank_reports;
DROP POLICY IF EXISTS "authenticated_delete_bank_reports" ON public.universal_bank_reports;

CREATE POLICY "Only admins and managers can update bank reports"
ON public.universal_bank_reports
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'manager') OR
  auth.uid() = user_id
);

CREATE POLICY "Only admins and owners can delete bank reports"
ON public.universal_bank_reports
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR 
  auth.uid() = user_id
);

-- Comment explaining the RBAC structure
COMMENT ON TABLE public.user_roles IS 'Stores user roles separately from profiles to prevent privilege escalation. Use has_role() function in RLS policies.';
COMMENT ON FUNCTION public.has_role IS 'Security definer function to check user roles without RLS recursion. Safe to use in RLS policies.';