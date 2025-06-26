export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
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
          client_code: string
          collection_amount: number
          commission: number | null
          created_at: string
          credited_date: string | null
          d_n_amount: number | null
          date_of_impay: string | null
          date_of_validity: string | null
          depo_ref: string | null
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
        }
        Insert: {
          bank_commission?: number | null
          bank_name?: string | null
          bank_name_display?: string | null
          client_code: string
          collection_amount: number
          commission?: number | null
          created_at?: string
          credited_date?: string | null
          d_n_amount?: number | null
          date_of_impay?: string | null
          date_of_validity?: string | null
          depo_ref?: string | null
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
        }
        Update: {
          bank_commission?: number | null
          bank_name?: string | null
          bank_name_display?: string | null
          client_code?: string
          collection_amount?: number
          commission?: number | null
          created_at?: string
          credited_date?: string | null
          d_n_amount?: number | null
          date_of_impay?: string | null
          date_of_validity?: string | null
          depo_ref?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
