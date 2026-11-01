Slugs must stay plain ASCII: strip the accents so `Tiếng Việt` becomes `tieng-viet`, and turn `đ` and `Đ` into `d`, so `Đà Nẵng` becomes `da-nang`. Everything else about `slugify` stays the same.
