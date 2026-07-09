export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      bank_audit_log: {
        Row: {
          action: string
          bank_name: string | null
          created_at: string | null
          details: Json | null
          id: string
          ip_address: unknown
          report_date: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          bank_name?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          report_date?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          bank_name?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          report_date?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bank_evolution_tracking: {
        Row: {
          amount: number | null
          bank_name: string
          created_at: string | null
          current_status: string | null
          description: string | null
          evolution_type: string
          id: string
          previous_status: string | null
          reference: string | null
          report_date: string
        }
        Insert: {
          amount?: number | null
          bank_name: string
          created_at?: string | null
          current_status?: string | null
          description?: string | null
          evolution_type: string
          id?: string
          previous_status?: string | null
          reference?: string | null
          report_date: string
        }
        Update: {
          amount?: number | null
          bank_name?: string
          created_at?: string | null
          current_status?: string | null
          description?: string | null
          evolution_type?: string
          id?: string
          previous_status?: string | null
          reference?: string | null
          report_date?: string
        }
        Relationships: []
      }
      bank_facilities: {
        Row: {
          available_amount: number
          bank_report_id: string | null
          created_at: string
          facility_type: string
          id: string
          limit_amount: number
          used_amount: number
        }
        Insert: {
          available_amount: number
          bank_report_id?: string | null
          created_at?: string
          facility_type: string
          id?: string
          limit_amount: number
          used_amount: number
        }
        Update: {
          available_amount?: number
          bank_report_id?: string | null
          created_at?: string
          facility_type?: string
          id?: string
          limit_amount?: number
          used_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_facilities_bank_report_id_fkey"
            columns: ["bank_report_id"]
            isOneToOne: false
            referencedRelation: "bank_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reports: {
        Row: {
          bank_name: string
          closing_balance: number
          created_at: string
          id: string
          opening_balance: number
          report_date: string
          updated_at: string
        }
        Insert: {
          bank_name: string
          closing_balance: number
          created_at?: string
          id?: string
          opening_balance: number
          report_date: string
          updated_at?: string
        }
        Update: {
          bank_name?: string
          closing_balance?: number
          created_at?: string
          id?: string
          opening_balance?: number
          report_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_reconciliation: {
        Row: {
          client_code: string
          client_name: string | null
          created_at: string
          id: string
          impayes_amount: number
          report_date: string
        }
        Insert: {
          client_code: string
          client_name?: string | null
          created_at?: string
          id?: string
          impayes_amount: number
          report_date: string
        }
        Update: {
          client_code?: string
          client_name?: string | null
          created_at?: string
          id?: string
          impayes_amount?: number
          report_date?: string
        }
        Relationships: []
      }
      collection_report: {
        Row: {
          bank_commission: number | null
          bank_name: string | null
          bank_name_display: string | null
          cheque_number: string | null
          cheque_status: string | null
          client_code: string
          collection_amount: number
          collection_type: string | null
          commission: number | null
          created_at: string
          credited_date: string | null
          d_n_amount: number | null
          date_of_impay: string | null
          date_of_validity: string | null
          depo_ref: string | null
          effet_echeance_date: string | null
          effet_status: string | null
          excel_filename: string | null
          excel_processed_at: string | null
          excel_source_row: number | null
          facture_no: string | null
          frais_escompte: number | null
          id: string
          income: number | null
          interet: number | null
          match_confidence: number | null
          match_method: string | null
          matched_bank_deposit_id: string | null
          nj: number | null
          no_chq_bd: string | null
          processed_at: string | null
          processing_status: string | null
          reglement_impaye: string | null
          remarques: string | null
          report_date: string
          sg_or_fa_no: string | null
          status: string | null
          taux: number | null
          tob: number | null
          unique_excel_traceability: string | null
        }
        Insert: {
          bank_commission?: number | null
          bank_name?: string | null
          bank_name_display?: string | null
          cheque_number?: string | null
          cheque_status?: string | null
          client_code: string
          collection_amount: number
          collection_type?: string | null
          commission?: number | null
          created_at?: string
          credited_date?: string | null
          d_n_amount?: number | null
          date_of_impay?: string | null
          date_of_validity?: string | null
          depo_ref?: string | null
          effet_echeance_date?: string | null
          effet_status?: string | null
          excel_filename?: string | null
          excel_processed_at?: string | null
          excel_source_row?: number | null
          facture_no?: string | null
          frais_escompte?: number | null
          id?: string
          income?: number | null
          interet?: number | null
          match_confidence?: number | null
          match_method?: string | null
          matched_bank_deposit_id?: string | null
          nj?: number | null
          no_chq_bd?: string | null
          processed_at?: string | null
          processing_status?: string | null
          reglement_impaye?: string | null
          remarques?: string | null
          report_date: string
          sg_or_fa_no?: string | null
          status?: string | null
          taux?: number | null
          tob?: number | null
          unique_excel_traceability?: string | null
        }
        Update: {
          bank_commission?: number | null
          bank_name?: string | null
          bank_name_display?: string | null
          cheque_number?: string | null
          cheque_status?: string | null
          client_code?: string
          collection_amount?: number
          collection_type?: string | null
          commission?: number | null
          created_at?: string
          credited_date?: string | null
          d_n_amount?: number | null
          date_of_impay?: string | null
          date_of_validity?: string | null
          depo_ref?: string | null
          effet_echeance_date?: string | null
          effet_status?: string | null
          excel_filename?: string | null
          excel_processed_at?: string | null
          excel_source_row?: number | null
          facture_no?: string | null
          frais_escompte?: number | null
          id?: string
          income?: number | null
          interet?: number | null
          match_confidence?: number | null
          match_method?: string | null
          matched_bank_deposit_id?: string | null
          nj?: number | null
          no_chq_bd?: string | null
          processed_at?: string | null
          processing_status?: string | null
          reglement_impaye?: string | null
          remarques?: string | null
          report_date?: string
          sg_or_fa_no?: string | null
          status?: string | null
          taux?: number | null
          tob?: number | null
          unique_excel_traceability?: string | null
        }
        Relationships: []
      }
      deposits_not_cleared: {
        Row: {
          bank_report_id: string | null
          client_code: string | null
          created_at: string
          date_depot: string
          date_valeur: string | null
          id: string
          montant: number
          reference: string | null
          type_reglement: string
        }
        Insert: {
          bank_report_id?: string | null
          client_code?: string | null
          created_at?: string
          date_depot: string
          date_valeur?: string | null
          id?: string
          montant: number
          reference?: string | null
          type_reglement: string
        }
        Update: {
          bank_report_id?: string | null
          client_code?: string | null
          created_at?: string
          date_depot?: string
          date_valeur?: string | null
          id?: string
          montant?: number
          reference?: string | null
          type_reglement?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_not_cleared_bank_report_id_fkey"
            columns: ["bank_report_id"]
            isOneToOne: false
            referencedRelation: "bank_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_position: {
        Row: {
          collections_not_deposited: number
          created_at: string
          deposit_for_day: number | null
          grand_total: number
          id: string
          payment_for_day: number | null
          report_date: string
          total_fund_available: number
        }
        Insert: {
          collections_not_deposited: number
          created_at?: string
          deposit_for_day?: number | null
          grand_total: number
          id?: string
          payment_for_day?: number | null
          report_date: string
          total_fund_available: number
        }
        Update: {
          collections_not_deposited?: number
          created_at?: string
          deposit_for_day?: number | null
          grand_total?: number
          id?: string
          payment_for_day?: number | null
          report_date?: string
          total_fund_available?: number
        }
        Relationships: []
      }
      fund_position_detail: {
        Row: {
          balance: number
          bank_name: string
          created_at: string
          fund_applied: number | null
          fund_position_id: string | null
          grand_balance: number
          id: string
          net_balance: number
          non_validated_deposit: number | null
        }
        Insert: {
          balance: number
          bank_name: string
          created_at?: string
          fund_applied?: number | null
          fund_position_id?: string | null
          grand_balance: number
          id?: string
          net_balance: number
          non_validated_deposit?: number | null
        }
        Update: {
          balance?: number
          bank_name?: string
          created_at?: string
          fund_applied?: number | null
          fund_position_id?: string | null
          grand_balance?: number
          id?: string
          net_balance?: number
          non_validated_deposit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fund_position_detail_fund_position_id_fkey"
            columns: ["fund_position_id"]
            isOneToOne: false
            referencedRelation: "fund_position"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_position_hold: {
        Row: {
          amount: number
          cheque_number: string | null
          client_bank: string | null
          client_name: string
          created_at: string
          days_remaining: number | null
          deposit_date: string | null
          facture_reference: string | null
          fund_position_id: string | null
          hold_date: string
          id: string
        }
        Insert: {
          amount: number
          cheque_number?: string | null
          client_bank?: string | null
          client_name: string
          created_at?: string
          days_remaining?: number | null
          deposit_date?: string | null
          facture_reference?: string | null
          fund_position_id?: string | null
          hold_date: string
          id?: string
        }
        Update: {
          amount?: number
          cheque_number?: string | null
          client_bank?: string | null
          client_name?: string
          created_at?: string
          days_remaining?: number | null
          deposit_date?: string | null
          facture_reference?: string | null
          fund_position_id?: string | null
          hold_date?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fund_position_hold_fund_position_id_fkey"
            columns: ["fund_position_id"]
            isOneToOne: false
            referencedRelation: "fund_position"
            referencedColumns: ["id"]
          },
        ]
      }
      impayes: {
        Row: {
          bank_report_id: string | null
          client_code: string
          created_at: string
          date_echeance: string
          date_retour: string | null
          description: string | null
          id: string
          montant: number
        }
        Insert: {
          bank_report_id?: string | null
          client_code: string
          created_at?: string
          date_echeance: string
          date_retour?: string | null
          description?: string | null
          id?: string
          montant: number
        }
        Update: {
          bank_report_id?: string | null
          client_code?: string
          created_at?: string
          date_echeance?: string
          date_retour?: string | null
          description?: string | null
          id?: string
          montant?: number
        }
        Relationships: [
          {
            foreignKeyName: "impayes_bank_report_id_fkey"
            columns: ["bank_report_id"]
            isOneToOne: false
            referencedRelation: "bank_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      universal_bank_reports: {
        Row: {
          bank_name: string
          checksum: string
          created_at: string | null
          id: string
          parser_version: string | null
          processed_data: Json
          raw_data: Json
          report_date: string
          user_id: string | null
        }
        Insert: {
          bank_name: string
          checksum: string
          created_at?: string | null
          id?: string
          parser_version?: string | null
          processed_data: Json
          raw_data: Json
          report_date: string
          user_id?: string | null
        }
        Update: {
          bank_name?: string
          checksum?: string
          created_at?: string | null
          id?: string
          parser_version?: string | null
          processed_data?: Json
          raw_data?: Json
          report_date?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clean_client_name: {
        Args: { client_code: string; description: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "auditor" | "manager" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "auditor", "manager", "user"],
    },
  },
} as const
