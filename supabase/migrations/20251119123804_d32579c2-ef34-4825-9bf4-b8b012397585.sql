-- Assouplir la policy UPDATE sur collection_report pour permettre les upserts via ON CONFLICT
ALTER POLICY "Only admins and managers can update collections"
ON public.collection_report
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'manager'::app_role) OR
  has_role(auth.uid(), 'auditor'::app_role) OR
  has_role(auth.uid(), 'user'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'manager'::app_role) OR
  has_role(auth.uid(), 'auditor'::app_role) OR
  has_role(auth.uid(), 'user'::app_role)
);
