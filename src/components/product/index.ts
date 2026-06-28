// Barrel file for all product components.
// Grouped by feature prefix for readability.

// ── Active branch ────────────────────────────────────────────────────────────
export * from "./active_branch_banner";
export * from "./active_branch_banner_server";

// ── Activity ─────────────────────────────────────────────────────────────────
export * from "./activity_bell";

// ── Agent ────────────────────────────────────────────────────────────────────
export * from "./agents/agent_branch_banner";
export * from "./agents/agent_children_panel";
export * from "./agents/agent_context_panel";
export * from "./agents/agent_create_dialog";
export * from "./agents/agent_exports_panel";
export * from "./agents/agent_from_template_dialog";
export * from "./agents/agent_import_dialog";
export * from "./agents/agent_lifecycle_menu";
export * from "./agents/agent_object_links_panel";
export * from "./agents/agent_overview_panel";
export * from "./agents/agent_reference_badge";
export * from "./agents/agent_skills_panel";
export * from "./agents/agent_source_editor";
export * from "./agents/agent_triggers_panel";
export * from "./agents/agent_trust_panels";
export * from "./agents/agent_type_badge";
export * from "./agents/agents_list_client";

// ── App shell ────────────────────────────────────────────────────────────────
export * from "./shell/app_breadcrumbs";
export * from "./shell/app_header";

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
export * from "./boxes/box_chat_panel";
export * from "./boxes/box_contents_tree";
export * from "./boxes/box_edit_dialog";
export * from "./boxes/box_graph_view";
export * from "./boxes/box_guide_panel";
export * from "./boxes/box_lifecycle_menu";
export * from "./boxes/box_overview_panel";
export * from "./boxes/box_public_toggle";
export * from "./boxes/box_search_panel";
export * from "./boxes/box_template_setup";
export * from "./create/create_box_dialog";
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
export * from "./workspace/workspace_conversation";

// ── Copy / export ────────────────────────────────────────────────────────────
export * from "./copy_as_json_button";
export * from "./export_menu";

// ── CRDT ─────────────────────────────────────────────────────────────────────
export * from "./crdt_presence_bar";

// ── Create dialogs ───────────────────────────────────────────────────────────
export * from "./create/create_folder_dialog";
export * from "./create/create_link_dialog";
export * from "./create/create_note_dialog";
export * from "./create/create_workflow_button";

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
export * from "./files/file_context_panel";
export * from "./files/file_create_dialog";
export * from "./files/file_editor";
export * from "./files/file_import_button";
export * from "./files/file_language_badge";
export * from "./files/file_lifecycle_menu";
export * from "./files/file_object_links_panel";

// ── Folder ───────────────────────────────────────────────────────────────────
export * from "./folders/folder_export_button";
export * from "./folders/folder_lifecycle_menu";
export * from "./folders/folder_policy_toggle";
export * from "./folders/folder_workspace_actions";

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
export * from "./shell/mobile_sidebar";
export * from "./shell/mobile_sidebar_footer";

// ── Note ─────────────────────────────────────────────────────────────────────
export * from "./notes/note_comments_panel";
export * from "./notes/note_crdt_editor";
export * from "./notes/note_editor";
export * from "./notes/note_entities_panel";
export * from "./notes/note_history_dialog";
export * from "./notes/note_history_panel";
export * from "./notes/note_import_dialog";
export * from "./notes/note_lifecycle_menu";
export * from "./notes/note_presence_avatars";
export * from "./notes/note_stub";
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
export * from "./operator/operator_activity_panel";
export * from "./operator/operator_api_keys_manager";
export * from "./operator/operator_event_stream";
export * from "./operator/operator_history_table";
export * from "./operator/operator_live_view";
export * from "./operator/operator_new_run_button";
export * from "./operator/operator_notification_prefs";
export * from "./operator/operator_panel";
export * from "./operator/operator_panel_trigger";
export * from "./operator/operator_prompts_manager";
export * from "./operator/operator_run_detail";
export * from "./operator/operator_run_diff";

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

// ── Skill ────────────────────────────────────────────────────────────────────
export * from "./skills/skill_children_panel";
export * from "./skills/skill_create_dialog";
export * from "./skills/skill_import_dialog";
export * from "./skills/skill_source_editor";
export * from "./skills/skill_subagent_panel";
export * from "./skills/skill_test_sandbox";
export * from "./skills/skill_trust_panels";
export * from "./skills/skills_list_client";

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
export * from "./shell/web_budget_card";
export * from "./shell/web_citation_badge";
export * from "./shell/web_session_row";
export * from "./shell/web_session_steps";

// ── Workflow ─────────────────────────────────────────────────────────────────
export * from "./workflows/workflow_canvas";
export * from "./workflows/workflow_row";
export * from "./workflows/workflow_run_row";
export * from "./workflows/workflow_template_card";

// ── Workspace ────────────────────────────────────────────────────────────────
export * from "./workspace/workspace_live_refresh";
export * from "./workspace/workspace_search_panel";
export * from "./workspace/workspace_switcher";
