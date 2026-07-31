PERYA DICE — Staff Panel + Profile Menu Fix

Replace the included files in your website project.

Dashboard behavior:
- Normal users and VIP users keep the original Profile menu:
  My Profile, Edit Profile Bio, Find Profiles, and Sign Out.
- Moderator, Administrator, and Head Administrator accounts also receive a separate Staff Panel button.
- The original hidden data-admin-link element was restored because account-menu.js expects it. Removing it prevented the Profile menu from initializing for normal users.

Staff access:
- Moderators: User & Room Control (room tools only), Workspace, Review Queue.
- Administrators and Head Administrators: Control Hub, User & Room Control, Workspace, Review Queue, Activity Console.
- Control Hub links remain hidden from moderators on staff pages.
