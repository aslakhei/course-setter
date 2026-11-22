
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "club_invites": {
                  Row: {
                    "club_id": string,"created_at": string,"created_by": string | null,"expires_at": string,"id": string,"revoked_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Update: {
                    "club_id"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_invites_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    }
                  ]
                },"club_members": {
                  Row: {
                    "club_id": string,"joined_at": string,"role": Database["public"]['Enums']["club_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"joined_at"?: string,"role"?: Database["public"]['Enums']["club_role"],"user_id": string
                  }
                  Update: {
                    "club_id"?: string,"joined_at"?: string,"role"?: Database["public"]['Enums']["club_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_members_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_members_user_id_profile_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"clubs": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"event_members": {
                  Row: {
                    "event_id": string,"invited_at": string,"invited_by": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"invited_at"?: string,"invited_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "event_id"?: string,"invited_at"?: string,"invited_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_members_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_members_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"event_revisions": {
                  Row: {
                    "doc": NonNullable<Json>,"event_id": string,"map_version_id": string | null,"revision": number,"saved_at": string,"saved_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "doc": NonNullable<Json>,"event_id": string,"map_version_id"?: string | null,"revision": number,"saved_at"?: string,"saved_by"?: string | null
                  }
                  Update: {
                    "doc"?: NonNullable<Json>,"event_id"?: string,"map_version_id"?: string | null,"revision"?: number,"saved_at"?: string,"saved_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_revisions_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_revisions_map_version_id_fkey"
      columns: ["map_version_id"]
isOneToOne: false
      referencedRelation: "map_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_revisions_saved_by_fkey"
      columns: ["saved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "club_id": string,"created_at": string,"created_by": string | null,"doc": NonNullable<Json>,"event_date": string | null,"id": string,"map_version_id": string,"name": string,"revision": number,"schema_version": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"created_at"?: string,"created_by"?: string | null,"doc": NonNullable<Json>,"event_date"?: string | null,"id"?: string,"map_version_id": string,"name": string,"revision"?: number,"schema_version"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "club_id"?: string,"created_at"?: string,"created_by"?: string | null,"doc"?: NonNullable<Json>,"event_date"?: string | null,"id"?: string,"map_version_id"?: string,"name"?: string,"revision"?: number,"schema_version"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_map_version_id_fkey"
      columns: ["map_version_id"]
isOneToOne: false
      referencedRelation: "map_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"exports": {
                  Row: {
                    "club_id": string,"course_ids": (string)[],"created_at": string,"error": string | null,"event_id": string,"expires_at": string,"file_name": string | null,"finished_at": string | null,"id": string,"path": string | null,"requested_by": string | null,"revision": number,"separate": boolean,"status": Database["public"]['Enums']["export_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"course_ids": (string)[],"created_at"?: string,"error"?: string | null,"event_id": string,"expires_at"?: string,"file_name"?: string | null,"finished_at"?: string | null,"id"?: string,"path"?: string | null,"requested_by"?: string | null,"revision": number,"separate"?: boolean,"status"?: Database["public"]['Enums']["export_status"]
                  }
                  Update: {
                    "club_id"?: string,"course_ids"?: (string)[],"created_at"?: string,"error"?: string | null,"event_id"?: string,"expires_at"?: string,"file_name"?: string | null,"finished_at"?: string | null,"id"?: string,"path"?: string | null,"requested_by"?: string | null,"revision"?: number,"separate"?: boolean,"status"?: Database["public"]['Enums']["export_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "exports_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exports_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "exports_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"error": string | null,"finished_at": string | null,"id": number,"locked_by": string | null,"locked_until": string | null,"max_attempts": number,"payload": NonNullable<Json>,"result": Json | null,"run_after": string,"started_at": string | null,"status": Database["public"]['Enums']["job_status"],"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: never,"locked_by"?: string | null,"locked_until"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"type": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: never,"locked_by"?: string | null,"locked_until"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"layout_assets": {
                  Row: {
                    "bytes": number | null,"club_id": string | null,"created_at": string,"error_code": string | null,"event_id": string | null,"height": number | null,"id": string,"kind": Database["public"]['Enums']["asset_kind"],"name": string,"original_path": string,"owner_id": string | null,"preview_path": string | null,"status": Database["public"]['Enums']["asset_status"],"uploaded_by": string | null,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes"?: number | null,"club_id"?: string | null,"created_at"?: string,"error_code"?: string | null,"event_id"?: string | null,"height"?: number | null,"id"?: string,"kind": Database["public"]['Enums']["asset_kind"],"name": string,"original_path": string,"owner_id"?: string | null,"preview_path"?: string | null,"status"?: Database["public"]['Enums']["asset_status"],"uploaded_by"?: string | null,"width"?: number | null
                  }
                  Update: {
                    "bytes"?: number | null,"club_id"?: string | null,"created_at"?: string,"error_code"?: string | null,"event_id"?: string | null,"height"?: number | null,"id"?: string,"kind"?: Database["public"]['Enums']["asset_kind"],"name"?: string,"original_path"?: string,"owner_id"?: string | null,"preview_path"?: string | null,"status"?: Database["public"]['Enums']["asset_status"],"uploaded_by"?: string | null,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "layout_assets_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "layout_assets_event_id_club_id_fkey"
      columns: ["event_id","club_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","club_id"]
    },{
      foreignKeyName: "layout_assets_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "layout_assets_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"map_versions": {
                  Row: {
                    "club_id": string,"contour_interval": number | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"error_code": string | null,"error_message": string | null,"file_name": string,"frame": Json | null,"georef": Json | null,"id": string,"kind": Database["public"]['Enums']["map_kind"],"map_id": string,"map_year": number | null,"mapper": string | null,"ocad_version": string | null,"original_path": string,"paper_height_mm": number | null,"paper_width_mm": number | null,"previous_version_id": string | null,"processed_at": string | null,"scale": number | null,"status": Database["public"]['Enums']["map_version_status"],"tiles": Json | null,"tiles_path": string | null,"transform_from_previous": Json | null,"transform_method": string | null,"transform_rms_m": number | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"contour_interval"?: number | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"error_code"?: string | null,"error_message"?: string | null,"file_name": string,"frame"?: Json | null,"georef"?: Json | null,"id"?: string,"kind": Database["public"]['Enums']["map_kind"],"map_id": string,"map_year"?: number | null,"mapper"?: string | null,"ocad_version"?: string | null,"original_path": string,"paper_height_mm"?: number | null,"paper_width_mm"?: number | null,"previous_version_id"?: string | null,"processed_at"?: string | null,"scale"?: number | null,"status"?: Database["public"]['Enums']["map_version_status"],"tiles"?: Json | null,"tiles_path"?: string | null,"transform_from_previous"?: Json | null,"transform_method"?: string | null,"transform_rms_m"?: number | null,"version": number
                  }
                  Update: {
                    "club_id"?: string,"contour_interval"?: number | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"error_code"?: string | null,"error_message"?: string | null,"file_name"?: string,"frame"?: Json | null,"georef"?: Json | null,"id"?: string,"kind"?: Database["public"]['Enums']["map_kind"],"map_id"?: string,"map_year"?: number | null,"mapper"?: string | null,"ocad_version"?: string | null,"original_path"?: string,"paper_height_mm"?: number | null,"paper_width_mm"?: number | null,"previous_version_id"?: string | null,"processed_at"?: string | null,"scale"?: number | null,"status"?: Database["public"]['Enums']["map_version_status"],"tiles"?: Json | null,"tiles_path"?: string | null,"transform_from_previous"?: Json | null,"transform_method"?: string | null,"transform_rms_m"?: number | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "map_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "map_versions_map_id_club_id_fkey"
      columns: ["map_id","club_id"]
isOneToOne: false
      referencedRelation: "maps"
      referencedColumns: ["id","club_id"]
    },{
      foreignKeyName: "map_versions_previous_version_id_fkey"
      columns: ["previous_version_id"]
isOneToOne: false
      referencedRelation: "map_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"maps": {
                  Row: {
                    "club_id": string,"created_at": string,"created_by": string | null,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string
                  }
                  Update: {
                    "club_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "maps_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maps_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"id": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invite":
{ Args: { "invite_token": string }; Returns: string
                           },
"claim_job":
{ Args: { "lock_seconds"?: number,"worker": string }; Returns: {
              "attempts": number,
"created_at": string,
"error": string | null,
"finished_at": string | null,
"id": number,
"locked_by": string | null,
"locked_until": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"type": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"complete_job":
{ Args: { "job_id": number,"job_result"?: Json }; Returns: undefined
                           },
"create_club":
{ Args: { "club_name": string }; Returns: string
                           },
"create_event":
{ Args: { "club": string,"event_date"?: string,"event_name": string,"map_version": string }; Returns: string
                           },
"delete_club":
{ Args: { "club": string }; Returns: undefined
                           },
"delete_layout_asset":
{ Args: { "asset_id": string }; Returns: undefined
                           },
"delete_map_version":
{ Args: { "map_version_id": string }; Returns: undefined
                           },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"event_layout_assets":
{ Args: { "event": string,"ids": (string)[] }; Returns: {
              "height": number,"id": string,"kind": Database["public"]['Enums']["asset_kind"],"original_path": string,"width": number
            }[]
                           },
"fail_job":
{ Args: { "job_error": string,"job_id": number }; Returns: undefined
                           },
"finish_asset_upload":
{ Args: { "asset_id": string }; Returns: undefined
                           },
"finish_map_upload":
{ Args: { "map_version_id": string }; Returns: undefined
                           },
"invite_info":
{ Args: { "invite_token": string }; Returns: {
              "already_member": boolean,"club_id": string,"club_name": string,"status": string
            }[]
                           },
"move_event_to_version":
{ Args: { "doc": Json,"event": string,"expected_revision": number,"map_version": string }; Returns: number
                           },
"my_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"request_export":
{ Args: { "course_ids": (string)[],"event": string,"separate"?: boolean }; Returns: string
                           },
"save_event":
{ Args: { "doc": Json,"event": string,"expected_revision": number }; Returns: number
                           },
"set_map_version_alignment":
{ Args: { "map_version_id": string,"rms_m": number,"transform": Json }; Returns: undefined
                           },
"set_map_version_details":
{ Args: { "contour_interval"?: number,"map_version_id": string,"map_year"?: number,"mapper"?: string }; Returns: undefined
                           },
"start_asset_upload":
{ Args: { "asset_name": string,"club"?: string,"event"?: string,"kind": Database["public"]['Enums']["asset_kind"],"scope": string }; Returns: {
              "asset_id": string,"upload_path": string
            }[]
                           },
"start_map_upload":
{ Args: { "club": string,"file_name": string,"kind": Database["public"]['Enums']["map_kind"],"map_id"?: string,"map_name"?: string,"scale"?: number }; Returns: {
              "upload_path": string,"version_id": string
            }[]
                           }
          }
          Enums: {
            "asset_kind": "png"|"jpeg"|"svg"|"pdf","asset_status": "uploading"|"processing"|"ready"|"failed","club_role": "admin"|"member","export_status": "queued"|"running"|"ready"|"failed"|"expired","job_status": "queued"|"running"|"done"|"failed","map_kind": "ocad"|"pdf","map_version_status": "uploading"|"processing"|"needs_alignment"|"ready"|"failed"|"deleted"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "asset_kind": ["png", "jpeg", "svg", "pdf"],"asset_status": ["uploading", "processing", "ready", "failed"],"club_role": ["admin", "member"],"export_status": ["queued", "running", "ready", "failed", "expired"],"job_status": ["queued", "running", "done", "failed"],"map_kind": ["ocad", "pdf"],"map_version_status": ["uploading", "processing", "needs_alignment", "ready", "failed", "deleted"]
          }
        }
} as const
