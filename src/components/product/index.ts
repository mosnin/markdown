// Barrel file for all product components.
// Grouped by feature prefix for readability.

// ── Active branch ────────────────────────────────────────────────────────────
export * from "./active_branch_banner";
export * from "./active_branch_banner_server";

// ── Activity ─────────────────────────────────────────────────────────────────
export * from "./activity_bell";

// ── Agent ────────────────────────────────────────────────────────────────────
export * from "./agent_branch_banner";
export * from "./agent_children_panel";
export * from "./agent_context_panel";
export * from "./agent_create_dialog";
export * from "./agent_exports_panel";
export * from "./agent_from_template_dialog";
export * from "./agent_import_dialog";
export * from "./agent_lifecycle_menu";
export * from "./agent_object_links_panel";
export * from "./agent_overview_panel";
export * from "./agent_reference_badge";
export * from "./agent_skills_panel";
export * from "./agent_source_editor";
export * from "./agent_triggers_panel";
export * from "./agent_trust_panels";
export * from "./agent_type_badge";
export * from "./agents_list_client";

// ── App shell ────────────────────────────────────────────────────────────────
export * from "./app_breadcrumbs";
export * from "./app_header";
export * from "./app_shell";
export * from "./app_shell_sidebar";
export * from "./app_sidebar";

// ── Approval / proposals ─────────────────────────────────────────────────────
export * from "./approval_queue";
export * from "./heterogeneous_proposal_card";
export * from "./proposal_target_summary";
export * from "./proposals_panel";

// ── Ask Pog ──────────────────────────────────────────────────────────────────
export * from "./ask_pog_inline_button";
export * from "./ask_pog_selection_popover";

// ── Attach ───────────────────────────────────────────────────────────────────
export * from "./attach_reusable_dialog";
export * from "./attach_to_box_dialog";
export * from "./attach_to_box_trigger";

// ── Audit ────────────────────────────────────────────────────────────────────
export * from "./audit_panel";

// ── Autosave ─────────────────────────────────────────────────────────────────
export * from "./autosave_status";

// ── Box ──────────────────────────────────────────────────────────────────────
export * from "./box_chat_panel";
export * from "./box_contents_tree";
export * from "./box_edit_dialog";
export * from "./box_graph_view";
export * from "./box_guide_panel";
export * from "./box_lifecycle_menu";
export * from "./box_overview_panel";
export * from "./box_public_toggle";
export * from "./box_search_panel";
export * from "./box_template_setup";
export * from "./create_box_dialog";
export * from "./share_box_button";

// ── Branch presence ──────────────────────────────────────────────────────────
export * from "./branch_presence_avatars";

// ── Bulk import ──────────────────────────────────────────────────────────────
export * from "./bulk_import_panel";

// ── Capture ──────────────────────────────────────────────────────────────────
export * from "./capture_view";

// ── Command palette ──────────────────────────────────────────────────────────
export * from "./command_palette";
export * from "./command_palette_provider";
export * from "./command_palette_provider_loader";

// ── Connection ───────────────────────────────────────────────────────────────
export * from "./connection_permission_hint";
export * from "./connections_panel";

// ── Context / conversation ───────────────────────────────────────────────────
export * from "./context_bundle_viewer";
export * from "./conversation_composer";
export * from "./conversation_home_client";
export * from "./workspace_conversation";

// ── Copy / export ────────────────────────────────────────────────────────────
export * from "./copy_as_json_button";
export * from "./export_menu";

// ── CRDT ─────────────────────────────────────────────────────────────────────
export * from "./crdt_presence_bar";

// ── Create dialogs ───────────────────────────────────────────────────────────
export * from "./create_folder_dialog";
export * from "./create_link_dialog";
export * from "./create_note_dialog";
export * from "./create_workflow_button";

// ── Dashboard ────────────────────────────────────────────────────────────────
export * from "./dashboard_card";
export * from "./dashboard_section";

// ── Editor ───────────────────────────────────────────────────────────────────
export * from "./editor_related_panel";
export * from "./source_editor";

// ── Empty state ──────────────────────────────────────────────────────────────
export * from "./empty_state";

// ── Enhanced event stream ────────────────────────────────────────────────────
export * from "./enhanced_event_stream";

// ── Entity ───────────────────────────────────────────────────────────────────
export * from "./entity_chip";
export * from "./entity_merge_dialog";

// ── File ─────────────────────────────────────────────────────────────────────
export * from "./file_context_panel";
export * from "./file_create_dialog";
export * from "./file_editor";
export * from "./file_import_button";
export * from "./file_language_badge";
export * from "./file_lifecycle_menu";
export * from "./file_object_links_panel";

// ── Folder ───────────────────────────────────────────────────────────────────
export * from "./folder_export_button";
export * from "./folder_lifecycle_menu";
export * from "./folder_policy_toggle";
export * from "./folder_workspace_actions";

// ── Generated note ───────────────────────────────────────────────────────────
export * from "./generated_note_banner";

// ── Global search ────────────────────────────────────────────────────────────
export * from "./global_search";

// ── Graph ────────────────────────────────────────────────────────────────────
export * from "./graph_panel";

// ── Guide note ───────────────────────────────────────────────────────────────
export * from "./guide_note_picker";

// ── Heterogeneous version ────────────────────────────────────────────────────
export * from "./heterogeneous_version_timeline";

// ── Image ────────────────────────────────────────────────────────────────────
export * from "./image_attachment";

// ── Import ───────────────────────────────────────────────────────────────────
export * from "./import_dialog";

// ── Insights ─────────────────────────────────────────────────────────────────
export * from "./insights_list";

// ── Knowledge graph ──────────────────────────────────────────────────────────
export * from "./kg_backfill_button";
export * from "./knowledge_graph_list";
export * from "./knowledge_graph_tabs";
export * from "./knowledge_graph_visual";

// ── Links ────────────────────────────────────────────────────────────────────
export * from "./link_suggestions_panel";
export * from "./linked_notes_section";
export * from "./semantic_links_panel";

// ── Live / streaming ─────────────────────────────────────────────────────────
export * from "./live_token_counter";
export * from "./streaming_run_view";

// ── Local search / index ─────────────────────────────────────────────────────
export * from "./local_index_bootstrap";
export * from "./local_search_results";

// ── Machine provenance ───────────────────────────────────────────────────────
export * from "./machine_provenance_panel";

// ── Markdown ─────────────────────────────────────────────────────────────────
export * from "./markdown_preview";

// ── Memory ───────────────────────────────────────────────────────────────────
export * from "./memory_panel";

// ── Metadata ─────────────────────────────────────────────────────────────────
export * from "./metadata_panel_stub";

// ── Mobile ───────────────────────────────────────────────────────────────────
export * from "./mobile_settings_sidebar";
export * from "./mobile_shell_sidebar";
export * from "./mobile_sidebar";
export * from "./mobile_sidebar_footer";

// ── Note ─────────────────────────────────────────────────────────────────────
export * from "./note_comments_panel";
export * from "./note_crdt_editor";
export * from "./note_editor";
export * from "./note_entities_panel";
export * from "./note_history_dialog";
export * from "./note_history_panel";
export * from "./note_import_dialog";
export * from "./note_lifecycle_menu";
export * from "./note_presence_avatars";
export * from "./note_stub";
export * from "./share_note_button";

// ── Object ───────────────────────────────────────────────────────────────────
export * from "./object_history_panel";
export * from "./object_lifecycle_panel";
export * from "./object_trust_header";
export * from "./shared_object_trust_badge";

// ── Onboarding ───────────────────────────────────────────────────────────────
export * from "./onboarding_callout";
export * from "./onboarding_milestone_bar";
export * from "./quick_start_panel";

// ── Operator ─────────────────────────────────────────────────────────────────
export * from "./operator_activity_panel";
export * from "./operator_api_keys_manager";
export * from "./operator_event_stream";
export * from "./operator_history_table";
export * from "./operator_live_view";
export * from "./operator_new_run_button";
export * from "./operator_notification_prefs";
export * from "./operator_panel";
export * from "./operator_panel_trigger";
export * from "./operator_prompts_manager";
export * from "./operator_run_detail";
export * from "./operator_run_diff";

// ── Page ─────────────────────────────────────────────────────────────────────
export * from "./page_header";
export * from "./panel_section";

// ── Persona ──────────────────────────────────────────────────────────────────
export * from "./persona_selector";

// ── Pin skill ────────────────────────────────────────────────────────────────
export * from "./pin_skill_toggle";

// ── Plan ─────────────────────────────────────────────────────────────────────
export * from "./plan_view";

// ── Pog agent ────────────────────────────────────────────────────────────────
export * from "./pog_agent_intro";

// ── Prose diff ───────────────────────────────────────────────────────────────
export * from "./prose_diff";

// ── Reference ────────────────────────────────────────────────────────────────
export * from "./reference_context_banner";
export * from "./retrieval_hint_badge";
export * from "./shared_reference_impact_notice";

// ── Run replay ───────────────────────────────────────────────────────────────
export * from "./run_replay_view";

// ── Save as template ─────────────────────────────────────────────────────────
export * from "./save_as_template_button";

// ── Settings ─────────────────────────────────────────────────────────────────
export * from "./settings_sidebar";

// ── Skill ────────────────────────────────────────────────────────────────────
export * from "./skill_children_panel";
export * from "./skill_create_dialog";
export * from "./skill_import_dialog";
export * from "./skill_source_editor";
export * from "./skill_subagent_panel";
export * from "./skill_test_sandbox";
export * from "./skill_trust_panels";
export * from "./skills_list_client";

// ── Slash command ────────────────────────────────────────────────────────────
export * from "./slash_command_menu";

// ── Steer ────────────────────────────────────────────────────────────────────
export * from "./steer_input";

// ── Subagent ─────────────────────────────────────────────────────────────────
export * from "./subagent_fanout_badge";
export * from "./subagent_invocation_row";

// ── Service worker ───────────────────────────────────────────────────────────
export * from "./sw_register";

// ── Template ─────────────────────────────────────────────────────────────────
export * from "./template_list_client";

// ── Theme ────────────────────────────────────────────────────────────────────
export * from "./theme_provider";
export * from "./theme_toggle";

// ── Toast ────────────────────────────────────────────────────────────────────
export * from "./toast_provider";

// ── Tool call ────────────────────────────────────────────────────────────────
export * from "./tool_call_card";

// ── Tree ─────────────────────────────────────────────────────────────────────
export * from "./tree_sidebar";
export * from "./tree_stub";

// ── Trigger ──────────────────────────────────────────────────────────────────
export * from "./trigger_runs_history_dialog";
export * from "./trigger_runs_summary_badge";

// ── Usage ────────────────────────────────────────────────────────────────────
export * from "./usage_breakdown_table";
export * from "./usage_spark_chart";

// ── User ─────────────────────────────────────────────────────────────────────
export * from "./user_menu";

// ── Voice ────────────────────────────────────────────────────────────────────
export * from "./voice_recorder_button";

// ── Web ──────────────────────────────────────────────────────────────────────
export * from "./web_budget_card";
export * from "./web_citation_badge";
export * from "./web_session_row";
export * from "./web_session_steps";

// ── Workflow ─────────────────────────────────────────────────────────────────
export * from "./workflow_canvas";
export * from "./workflow_row";
export * from "./workflow_run_row";
export * from "./workflow_template_card";

// ── Workspace ────────────────────────────────────────────────────────────────
export * from "./workspace_live_refresh";
export * from "./workspace_search_panel";
export * from "./workspace_switcher";
