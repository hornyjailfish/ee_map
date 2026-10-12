DEFINE BUCKET OVERWRITE  images BACKEND "${bucket_path}?lowercase_paths=true" PERMISSIONS WHERE $auth.id != NONE;
DEFINE BUCKET draft BACKEND "memory";
