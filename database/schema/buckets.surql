DEFINE BUCKET images BACKEND "${bucket_path}" PERMISSIONS WHERE $auth.id != NONE;
DEFINE BUCKET draft BACKEND "memory";
