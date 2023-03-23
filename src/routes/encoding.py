import os

def save(path, content, only_if_modified=False, encoding="utf-8"):
    """
    Saves a file with given content
    Params:
        path: path to write file to
        content: contents to save in the file
        only_if_modified: file won't be modified if the content hasn't changed
        encoding: target file text encoding
    """
    dir_path = os.path.dirname(path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)
    with open(path, "w", encoding=encoding, newline="") as handle:
        handle.write(content)



# encoding = 'utf-8'
encoding = 'cp1252'

# b'hello'.decode(encoding)

# hex_string = '1f8b08080000000002ff636f6e616e5f'
hex_string = '1fefbfbd08080000000002efbfbd636f6e616e5f'
ba = bytes.fromhex(hex_string)
print(ba)

# encoded = ba.decode('cp1252')
encoded = ba.decode('utf-8')
print(encoded)

newFilePath = '/home/fernando/dev/conan-server/tmp/k-nuth/conan-packages/master/project1/2.0.0/_/_/9d9c0e529e2865cda9823c2c233f7d36/conan_sources_new.tgz'
save(newFilePath, encoded, encoding="cp1252")







# ---------------------------------------------

# import chardet

# # hex_string = '1f8b08080000000002ff636f6e616e5f'
# hex_string = '1fefbfbd08080000000002efbfbd636f6e616e5f'
# ba = bytes.fromhex(hex_string)


# # the_encoding = chardet.detect(b'your string')['encoding']
# the_encoding = chardet.detect(ba)['encoding']
# print(the_encoding)